import { join } from "node:path";
import { AgentAuditCollector } from "./audit.js";
import { proposeNextActions } from "./brain.js";
import { createToolRegistry } from "./tools/registry.js";
import type { ToolRunContext, ToolSpec } from "./tools/types.js";
import { getProviderFromEnv } from "../llm/index.js";
import type { LlmProvider } from "../llm/provider.js";
import { runCmd, type CmdResult } from "../runner/runCmd.js";
import type { AgentState, ErrorKind, VerifyProjectResult } from "./types.js";

const truncate = (value: string, max = 4000): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

const classifyFromVerify = (result: VerifyProjectResult): ErrorKind => result.classifiedError;

const summarizeState = (state: AgentState): unknown => ({
  phase: state.phase,
  goal: state.goal,
  projectRoot: state.projectRoot,
  appDir: state.appDir,
  flags: state.flags,
  budgets: state.budgets,
  verifyHistory: state.verifyHistory.map((item) => ({ ok: item.ok, step: item.step, summary: item.summary })),
  lastError: state.lastError,
  patchPaths: state.patchPaths,
  touchedFiles: state.touchedFiles.slice(-30)
});

const inferRepairCommand = (state: AgentState): { cmd: string; args: string[]; cwd: string } | null => {
  const latest = state.verifyHistory[state.verifyHistory.length - 1];
  const root = state.appDir;
  if (!latest || !root || latest.ok) return null;

  if (latest.step === "install" || latest.step === "install_retry") return { cmd: "pnpm", args: ["-C", root, "install"], cwd: root };
  if (latest.step === "build" || latest.step === "build_retry") return { cmd: "pnpm", args: ["-C", root, "build"], cwd: root };
  if (latest.step === "cargo_check") return { cmd: "cargo", args: ["check"], cwd: join(root, "src-tauri") };
  if (latest.step === "tauri_build") return { cmd: "pnpm", args: ["-C", root, "tauri", "build"], cwd: root };
  return { cmd: "pnpm", args: ["-C", root, "tauri", "--help"], cwd: root };
};

const normalizeToolResults = (toolName: string, ok: boolean, note?: string): { name: string; ok: boolean; note?: string } => ({
  name: toolName,
  ok,
  note
});

export const runAgent = async (args: {
  goal: string;
  specPath: string;
  outDir: string;
  apply: boolean;
  verify: boolean;
  repair: boolean;
  llmEnrichSpec?: boolean;
  verifyLevel?: "basic" | "full";
  maxTurns?: number;
  maxToolCallsPerTurn?: number;
  maxPatches?: number;
  provider?: LlmProvider;
  runCmdImpl?: (cmd: string, argv: string[], cwd: string) => Promise<CmdResult>;
  registry?: Record<string, ToolSpec<any>>;
  registryDeps?: Parameters<typeof createToolRegistry>[0];
}): Promise<{ ok: boolean; summary: string; auditPath?: string; patchPaths?: string[]; state: AgentState }> => {
  const provider = args.provider ?? getProviderFromEnv();
  const runCmdImpl = args.runCmdImpl ?? runCmd;
  const maxTurns = args.maxTurns ?? 8;
  const maxToolCallsPerTurn = args.maxToolCallsPerTurn ?? 4;
  const maxPatches = args.maxPatches ?? 8;

  const registry = args.registry ?? createToolRegistry(args.registryDeps);

  const state: AgentState = {
    phase: "BOOT",
    goal: args.goal,
    specPath: args.specPath,
    outDir: args.outDir,
    flags: {
      apply: args.apply,
      verify: args.verify,
      repair: args.repair,
      llmEnrich: args.llmEnrichSpec ?? false,
      verifyLevel: args.verifyLevel ?? "basic"
    },
    usedLLM: false,
    verifyHistory: [],
    budgets: {
      maxTurns,
      maxPatches,
      usedTurns: 0,
      usedPatches: 0,
      usedRepairs: 0
    },
    patchPaths: [],
    touchedFiles: [],
    toolCalls: [],
    toolResults: []
  };

  const ctx: ToolRunContext = {
    provider,
    runCmdImpl,
    flags: {
      apply: state.flags.apply,
      verify: state.flags.verify,
      repair: state.flags.repair,
      maxPatchesPerTurn: maxPatches,
      verifyLevel: state.flags.verifyLevel
    },
    memory: {
      specPath: state.specPath,
      outDir: state.outDir,
      patchPaths: [],
      touchedPaths: []
    }
  };

  const audit = new AgentAuditCollector(args.goal);

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    state.budgets.usedTurns = turn;

    const proposed = await proposeNextActions({
      goal: state.goal,
      provider,
      registry,
      stateSummary: summarizeState(state),
      maxToolCallsPerTurn
    });

    let toolCalls = [...proposed.toolCalls];

    if (state.phase === "BOOT" && !toolCalls.some((call) => call.name === "tool_bootstrap_project")) {
      toolCalls = [
        {
          name: "tool_bootstrap_project",
          input: {
            specPath: state.specPath,
            outDir: state.outDir,
            apply: state.flags.apply,
            llmEnrich: state.flags.llmEnrich
          }
        }
      ];
    } else if (state.phase === "VERIFY" && state.appDir && !toolCalls.some((call) => call.name === "tool_verify_project")) {
      toolCalls = [{ name: "tool_verify_project", input: { projectRoot: state.appDir, verifyLevel: state.flags.verifyLevel } }];
    } else if (state.phase === "REPAIR") {
      const repairCmd = inferRepairCommand(state);
      if (repairCmd && !toolCalls.some((call) => call.name === "tool_repair_once")) {
        toolCalls = [
          {
            name: "tool_repair_once",
            input: {
              projectRoot: state.appDir,
              cmd: repairCmd.cmd,
              args: repairCmd.args
            }
          },
          {
            name: "tool_verify_project",
            input: { projectRoot: state.appDir, verifyLevel: state.flags.verifyLevel }
          }
        ];
      }
    }

    state.toolCalls = toolCalls;
    state.toolResults = [];

    const turnAuditResults: Array<{ name: string; ok: boolean; error?: string; touchedPaths?: string[] }> = [];

    for (const call of toolCalls) {
      const tool = registry[call.name] as ToolSpec | undefined;
      if (!tool) {
        const note = `unknown tool ${call.name}`;
        state.toolResults.push(normalizeToolResults(call.name, false, note));
        turnAuditResults.push({ name: call.name, ok: false, error: note });
        state.lastError = { kind: "Unknown", message: note };
        continue;
      }

      const parsed = tool.inputSchema.safeParse(call.input);
      if (!parsed.success) {
        const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
        state.toolResults.push(normalizeToolResults(call.name, false, detail));
        turnAuditResults.push({ name: call.name, ok: false, error: detail });
        state.lastError = { kind: "Config", message: detail };
        continue;
      }

      const result = await tool.run(parsed.data, ctx);
      const touched = result.meta?.touchedPaths ?? [];
      state.touchedFiles = Array.from(new Set([...state.touchedFiles, ...touched]));
      state.patchPaths = Array.from(new Set([...state.patchPaths, ...ctx.memory.patchPaths]));

      state.toolResults.push(normalizeToolResults(call.name, result.ok, result.ok ? "ok" : result.error?.message));
      turnAuditResults.push({
        name: call.name,
        ok: result.ok,
        error: result.ok ? undefined : `${result.error?.message ?? "tool failed"}${result.error?.detail ? ` (${truncate(result.error.detail)})` : ""}`,
        touchedPaths: touched
      });

      if (call.name === "tool_bootstrap_project" && result.ok) {
        const data = result.data as { appDir: string; usedLLM: boolean };
        state.appDir = data.appDir;
        state.projectRoot = data.appDir;
        state.usedLLM = data.usedLLM;
        state.phase = state.flags.verify ? "VERIFY" : "DONE";
      }

      if (call.name === "tool_verify_project") {
        const verifyData = result.data as VerifyProjectResult;
        state.verifyHistory.push(verifyData);

        if (verifyData.ok) {
          state.phase = "DONE";
          state.lastError = undefined;
        } else {
          state.lastError = {
            kind: classifyFromVerify(verifyData),
            message: verifyData.summary,
            command: inferRepairCommand(state) ?? undefined
          };
          state.phase = state.flags.repair ? "REPAIR" : "FAILED";
        }
      }

      if (call.name === "tool_repair_once") {
        state.budgets.usedRepairs += 1;
        state.budgets.usedPatches = state.budgets.usedRepairs;
        if (!result.ok) {
          state.lastError = {
            kind: state.lastError?.kind ?? "Unknown",
            message: result.error?.message ?? "repair failed"
          };
          state.phase = "FAILED";
        } else {
          state.phase = "VERIFY";
        }
      }

      if (!result.ok && call.name !== "tool_verify_project" && call.name !== "tool_repair_once") {
        state.lastError = {
          kind: "Unknown",
          message: result.error?.message ?? "tool failed"
        };
      }

      if (state.budgets.usedRepairs > state.budgets.maxPatches) {
        state.phase = "FAILED";
        state.lastError = {
          kind: "Config",
          message: `Repair budget exceeded: ${state.budgets.usedRepairs} > ${state.budgets.maxPatches}`
        };
      }
    }

    audit.recordTurn({
      turn,
      llmRaw: proposed.raw,
      note: proposed.reasoning,
      toolCalls,
      toolResults: turnAuditResults
    });

    if (state.phase === "DONE") {
      const base = state.appDir ?? state.outDir;
      const auditPath = await audit.flush(base, {
        ok: true,
        phase: state.phase,
        verifyHistory: state.verifyHistory,
        patchPaths: state.patchPaths,
        touchedFiles: state.touchedFiles.slice(-200),
        budgets: state.budgets
      });
      return {
        ok: true,
        summary: "Agent completed successfully",
        auditPath,
        patchPaths: state.patchPaths,
        state
      };
    }

    if (state.phase === "FAILED") {
      break;
    }
  }

  state.phase = "FAILED";
  if (!state.lastError) {
    state.lastError = { kind: "Unknown", message: "max turns reached" };
  }

  const base = state.appDir ?? state.outDir;
  const auditPath = await audit.flush(base, {
    ok: false,
    phase: state.phase,
    verifyHistory: state.verifyHistory,
    lastError: state.lastError,
    patchPaths: state.patchPaths,
    touchedFiles: state.touchedFiles.slice(-200),
    budgets: state.budgets
  });

  return {
    ok: false,
    summary: `Agent failed: ${state.lastError.message}`,
    auditPath,
    patchPaths: state.patchPaths,
    state
  };
};
