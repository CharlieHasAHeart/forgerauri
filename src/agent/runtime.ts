import { join } from "node:path";
import { AgentAuditCollector } from "./audit.js";
import { proposeNextActions } from "./brain.js";
import { createToolRegistry, loadToolRegistryWithDocs } from "./tools/registry.js";
import { buildToolDocPack } from "./tools/loader.js";
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
  contractPath: state.contractPath,
  uxPath: state.uxPath,
  implPath: state.implPath,
  deliveryPath: state.deliveryPath,
  counts: {
    contractCommands: state.contract?.commands.length ?? 0,
    uxScreens: state.ux?.screens.length ?? 0,
    implServices: state.impl?.rust.services.length ?? 0,
    deliveryChecks: state.delivery?.preflight.checks.length ?? 0
  },
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

const requiredInput = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
};

export const runAgent = async (args: {
  goal: string;
  specPath: string;
  outDir: string;
  apply: boolean;
  verify: boolean;
  repair: boolean;
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
  const maxTurns = args.maxTurns ?? 16;
  const maxToolCallsPerTurn = args.maxToolCallsPerTurn ?? 4;
  const maxPatches = args.maxPatches ?? 8;

  const discovered = args.registry ? null : await loadToolRegistryWithDocs(args.registryDeps);
  const registry = args.registry ?? discovered?.registry ?? (await createToolRegistry(args.registryDeps));
  const toolDocs = discovered?.docs ?? buildToolDocPack(registry);

  const state: AgentState = {
    phase: "BOOT",
    goal: args.goal,
    specPath: args.specPath,
    outDir: args.outDir,
    flags: {
      apply: args.apply,
      verify: args.verify,
      repair: args.repair,
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
      toolDocs,
      stateSummary: summarizeState(state),
      maxToolCallsPerTurn
    });

    let toolCalls = [...proposed.toolCalls];

    try {
      if (state.phase === "BOOT") {
        toolCalls = [
          {
            name: "tool_bootstrap_project",
            input: {
              specPath: state.specPath,
              outDir: state.outDir,
              apply: state.flags.apply
            }
          }
        ];
      } else if (state.phase === "DESIGN_CONTRACT") {
        toolCalls = [
          {
            name: "tool_design_contract",
            input: {
              goal: state.goal,
              specPath: state.specPath,
              projectRoot: state.appDir
            }
          }
        ];
      } else if (state.phase === "MATERIALIZE_CONTRACT") {
        toolCalls = [
          {
            name: "tool_materialize_contract",
            input: {
              contract: requiredInput(state.contract, "materialize contract phase missing contract"),
              outDir: state.outDir,
              appDir: requiredInput(state.appDir, "materialize contract phase missing appDir"),
              apply: state.flags.apply
            }
          }
        ];
      } else if (state.phase === "DESIGN_UX") {
        toolCalls = [
          {
            name: "tool_design_ux",
            input: {
              goal: state.goal,
              specPath: state.specPath,
              contract: requiredInput(state.contract, "design ux phase missing contract"),
              projectRoot: state.appDir
            }
          }
        ];
      } else if (state.phase === "MATERIALIZE_UX") {
        toolCalls = [
          {
            name: "tool_materialize_ux",
            input: {
              ux: requiredInput(state.ux, "materialize ux phase missing ux"),
              projectRoot: requiredInput(state.appDir, "materialize ux phase missing appDir"),
              apply: state.flags.apply
            }
          }
        ];
      } else if (state.phase === "DESIGN_IMPL") {
        toolCalls = [
          {
            name: "tool_design_implementation",
            input: {
              goal: state.goal,
              contract: requiredInput(state.contract, "design implementation phase missing contract"),
              ux: state.ux,
              projectRoot: state.appDir
            }
          }
        ];
      } else if (state.phase === "MATERIALIZE_IMPL") {
        toolCalls = [
          {
            name: "tool_materialize_implementation",
            input: {
              impl: requiredInput(state.impl, "materialize implementation phase missing impl"),
              projectRoot: requiredInput(state.appDir, "materialize implementation phase missing appDir"),
              apply: state.flags.apply
            }
          }
        ];
      } else if (state.phase === "DESIGN_DELIVERY") {
        toolCalls = [
          {
            name: "tool_design_delivery",
            input: {
              goal: state.goal,
              contract: requiredInput(state.contract, "design delivery phase missing contract"),
              projectRoot: state.appDir
            }
          }
        ];
      } else if (state.phase === "MATERIALIZE_DELIVERY") {
        toolCalls = [
          {
            name: "tool_materialize_delivery",
            input: {
              delivery: requiredInput(state.delivery, "materialize delivery phase missing delivery"),
              projectRoot: requiredInput(state.appDir, "materialize delivery phase missing appDir"),
              apply: state.flags.apply
            }
          }
        ];
      } else if (state.phase === "VERIFY" && state.appDir) {
        toolCalls = [{ name: "tool_verify_project", input: { projectRoot: state.appDir, verifyLevel: state.flags.verifyLevel } }];
      } else if (state.phase === "REPAIR") {
        const repairCmd = inferRepairCommand(state);
        if (repairCmd) {
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
    } catch (error) {
      state.phase = "FAILED";
      state.lastError = {
        kind: "Config",
        message: error instanceof Error ? error.message : "phase input missing"
      };
      toolCalls = [];
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
        state.phase = "FAILED";
        continue;
      }

      const parsed = tool.inputSchema.safeParse(call.input);
      if (!parsed.success) {
        const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
        state.toolResults.push(normalizeToolResults(call.name, false, detail));
        turnAuditResults.push({ name: call.name, ok: false, error: detail });
        state.lastError = { kind: "Config", message: detail };
        state.phase = "FAILED";
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
        state.phase = "DESIGN_CONTRACT";
      }

      if (call.name === "tool_design_contract" && result.ok) {
        const data = result.data as { contract: AgentState["contract"] };
        state.contract = data.contract;
        state.phase = "MATERIALIZE_CONTRACT";
      }

      if (call.name === "tool_materialize_contract" && result.ok) {
        const data = result.data as { appDir: string; contractPath: string };
        state.appDir = data.appDir;
        state.projectRoot = data.appDir;
        state.contractPath = data.contractPath;
        state.phase = "DESIGN_UX";
      }

      if (call.name === "tool_design_ux" && result.ok) {
        const data = result.data as { ux: AgentState["ux"] };
        state.ux = data.ux;
        state.phase = "MATERIALIZE_UX";
      }

      if (call.name === "tool_materialize_ux" && result.ok) {
        const data = result.data as { uxPath: string };
        state.uxPath = data.uxPath;
        state.phase = "DESIGN_IMPL";
      }

      if (call.name === "tool_design_implementation" && result.ok) {
        const data = result.data as { impl: AgentState["impl"] };
        state.impl = data.impl;
        state.phase = "MATERIALIZE_IMPL";
      }

      if (call.name === "tool_materialize_implementation" && result.ok) {
        const data = result.data as { implPath: string };
        state.implPath = data.implPath;
        state.phase = "DESIGN_DELIVERY";
      }

      if (call.name === "tool_design_delivery" && result.ok) {
        const data = result.data as { delivery: AgentState["delivery"] };
        state.delivery = data.delivery;
        state.phase = "MATERIALIZE_DELIVERY";
      }

      if (call.name === "tool_materialize_delivery" && result.ok) {
        const data = result.data as { deliveryPath: string };
        state.deliveryPath = data.deliveryPath;
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
        state.phase = "FAILED";
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
    patchPaths: state.patchPaths,
    touchedFiles: state.touchedFiles.slice(-200),
    budgets: state.budgets,
    lastError: state.lastError
  });

  return {
    ok: false,
    summary: state.lastError.message,
    auditPath,
    patchPaths: state.patchPaths,
    state
  };
};
