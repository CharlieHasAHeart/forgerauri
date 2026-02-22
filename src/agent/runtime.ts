import { join } from "node:path";
import { AgentAuditCollector } from "./audit.js";
import { proposeNextActions } from "./brain.js";
import { createToolRegistry } from "./tools/registry.js";
import type { ToolRunContext, ToolSpec } from "./tools/types.js";
import { getProviderFromEnv } from "../llm/index.js";
import type { LlmProvider } from "../llm/provider.js";
import { runCmd, type CmdResult } from "../runner/runCmd.js";

type AgentMemory = ToolRunContext["memory"] & {
  errors: string[];
  applyDone: boolean;
  verifyDone: boolean;
  repaired: boolean;
};

const defaultVerifyCall = (projectRoot: string): { cwd: string; cmd: string; args: string[] } => ({
  cwd: projectRoot,
  cmd: "pnpm",
  args: ["-C", projectRoot, "test"]
});

const summarizeState = (memory: AgentMemory, goal: string, turn: number): unknown => ({
  goal,
  turn,
  appDir: memory.appDir,
  hasIR: Boolean(memory.ir),
  hasPlan: Boolean(memory.plan),
  applyDone: memory.applyDone,
  verifyDone: memory.verifyDone,
  verifyOk: memory.verifyResult?.ok,
  patchPaths: memory.patchPaths,
  touchedPaths: memory.touchedPaths.slice(-20),
  lastError: memory.errors[memory.errors.length - 1]
});

const toolErrorToMessage = (tool: string, result: { error?: { message: string; detail?: string } }): string =>
  `${tool}: ${result.error?.message ?? "unknown error"}${result.error?.detail ? ` (${result.error.detail})` : ""}`;

export const runAgent = async (args: {
  goal: string;
  specPath: string;
  outDir: string;
  apply: boolean;
  verify: boolean;
  repair: boolean;
  maxTurns?: number;
  maxToolCallsPerTurn?: number;
  maxPatchesPerTurn?: number;
  provider?: LlmProvider;
  runCmdImpl?: (cmd: string, argv: string[], cwd: string) => Promise<CmdResult>;
}): Promise<{ ok: boolean; summary: string; auditPath?: string; patchPaths?: string[] }> => {
  const provider = args.provider ?? getProviderFromEnv();
  const runCmdImpl = args.runCmdImpl ?? runCmd;
  const maxTurns = args.maxTurns ?? 8;
  const maxToolCallsPerTurn = args.maxToolCallsPerTurn ?? 4;
  const maxPatchesPerTurn = args.maxPatchesPerTurn ?? 8;

  const registry = createToolRegistry();
  const memory: AgentMemory = {
    specPath: args.specPath,
    outDir: args.outDir,
    patchPaths: [],
    touchedPaths: [],
    errors: [],
    applyDone: false,
    verifyDone: false,
    repaired: false
  };

  const ctx: ToolRunContext = {
    provider,
    runCmdImpl,
    flags: {
      apply: args.apply,
      verify: args.verify,
      repair: args.repair,
      maxPatchesPerTurn
    },
    memory
  };

  const audit = new AgentAuditCollector(args.goal);

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const summary = summarizeState(memory, args.goal, turn);
    const proposed = await proposeNextActions({
      goal: args.goal,
      provider,
      registry,
      stateSummary: summary,
      maxToolCallsPerTurn
    });

    const toolResults: Array<{ name: string; ok: boolean; error?: string; touchedPaths?: string[] }> = [];

    for (const call of proposed.toolCalls) {
      const tool = registry[call.name] as ToolSpec | undefined;
      if (!tool) {
        memory.errors.push(`Unknown tool at runtime: ${call.name}`);
        toolResults.push({ name: call.name, ok: false, error: "unknown tool" });
        continue;
      }

      const parsed = tool.inputSchema.safeParse(call.input);
      if (!parsed.success) {
        const error = parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
        memory.errors.push(`${call.name}: ${error}`);
        toolResults.push({ name: call.name, ok: false, error });
        continue;
      }

      const result = await tool.run(parsed.data, ctx);
      toolResults.push({
        name: call.name,
        ok: result.ok,
        error: result.ok ? undefined : toolErrorToMessage(call.name, result),
        touchedPaths: result.meta?.touchedPaths
      });

      if (!result.ok) {
        memory.errors.push(toolErrorToMessage(call.name, result));
      }

      if (call.name === "tool_apply_plan" && result.ok) {
        memory.applyDone = true;
      }

      if (call.name === "tool_run_cmd") {
        memory.verifyDone = true;
      }

      if (call.name === "tool_repair_once" && result.ok) {
        memory.repaired = true;
      }
    }

    audit.recordTurn({
      turn,
      llmRaw: proposed.raw,
      note: proposed.reasoning,
      toolCalls: proposed.toolCalls,
      toolResults
    });

    const verifyOk = memory.verifyResult?.ok === true;

    if (args.verify) {
      if (verifyOk) {
        const root = memory.appDir ?? args.outDir;
        const auditPath = await audit.flush(root, {
          ok: true,
          reason: "verify passed",
          patchPaths: memory.patchPaths,
          touchedPaths: memory.touchedPaths.slice(-200)
        });
        return {
          ok: true,
          summary: "Agent finished: verify passed",
          auditPath,
          patchPaths: memory.patchPaths
        };
      }

      if (memory.verifyDone && !verifyOk && args.repair && !memory.repaired && memory.appDir) {
        const repairTool = registry.tool_repair_once;
        const verifyTool = registry.tool_run_cmd;

        const repairInput = {
          projectRoot: memory.appDir,
          cmd: "pnpm",
          args: ["-C", memory.appDir, "test"]
        };
        const repairRes = await repairTool.run(repairInput, ctx);

        const verifyInput = defaultVerifyCall(memory.appDir);
        const verifyRes = await verifyTool.run(verifyInput, ctx);
        memory.verifyDone = true;
        memory.repaired = true;

        audit.recordTurn({
          turn,
          llmRaw: "<runtime_auto_repair>",
          toolCalls: [
            { name: "tool_repair_once", input: repairInput },
            { name: "tool_run_cmd", input: verifyInput }
          ],
          toolResults: [
            {
              name: "tool_repair_once",
              ok: repairRes.ok,
              error: repairRes.ok ? undefined : toolErrorToMessage("tool_repair_once", repairRes),
              touchedPaths: repairRes.meta?.touchedPaths
            },
            {
              name: "tool_run_cmd",
              ok: verifyRes.ok,
              error: verifyRes.ok ? undefined : toolErrorToMessage("tool_run_cmd", verifyRes),
              touchedPaths: verifyRes.meta?.touchedPaths
            }
          ]
        });

        if (memory.verifyResult?.ok) {
          const root = memory.appDir ?? args.outDir;
          const auditPath = await audit.flush(root, {
            ok: true,
            reason: "verify passed after repair",
            patchPaths: memory.patchPaths,
            touchedPaths: memory.touchedPaths.slice(-200)
          });
          return {
            ok: true,
            summary: "Agent finished: verify passed after repair",
            auditPath,
            patchPaths: memory.patchPaths
          };
        }
      }
    } else if (args.apply ? memory.applyDone : Boolean(memory.plan)) {
      const root = memory.appDir ?? args.outDir;
      const auditPath = await audit.flush(root, {
        ok: true,
        reason: args.apply ? "apply completed" : "plan completed",
        patchPaths: memory.patchPaths,
        touchedPaths: memory.touchedPaths.slice(-200)
      });
      return {
        ok: true,
        summary: args.apply ? "Agent finished: apply completed" : "Agent finished: plan completed",
        auditPath,
        patchPaths: memory.patchPaths
      };
    }
  }

  const root = memory.appDir ?? join(args.outDir);
  const auditPath = await audit.flush(root, {
    ok: false,
    reason: "max turns reached",
    errors: memory.errors.slice(-20),
    patchPaths: memory.patchPaths,
    touchedPaths: memory.touchedPaths.slice(-200)
  });

  return {
    ok: false,
    summary: "Agent stopped: max turns reached before completion",
    auditPath,
    patchPaths: memory.patchPaths
  };
};
