import { AgentTurnAuditCollector } from "../../runtime/audit/index.js";
import { renderToolIndex } from "../planning/tool_index.js";
import { defaultAgentPolicy, type AgentPolicy } from "../policy/policy.js";
import { createToolRegistry, loadToolRegistryWithDocs } from "../tools/registry.js";
import type { ToolRunContext, ToolSpec } from "../tools/types.js";
import { getProviderFromEnv } from "../../llm/index.js";
import type { LlmProvider } from "../../llm/provider.js";
import { runCmd, type CmdResult } from "../../runner/runCmd.js";
import type { AgentState } from "../types.js";
import { runPlanFirstAgent } from "./orchestrator.js";
import type { HumanReviewFn } from "./executor.js";
import type { PlanChangeReviewFn } from "./replanner.js";
import type { AgentEvent } from "./events.js";

export const runAgent = async (args: {
  goal: string;
  specPath: string;
  outDir: string;
  apply: boolean;
  verify: boolean;
  repair: boolean;
  policy?: AgentPolicy;
  maxTurns?: number;
  maxToolCallsPerTurn?: number;
  maxPatches?: number;
  truncation?: "auto" | "disabled";
  compactionThreshold?: number;
  provider?: LlmProvider;
  runCmdImpl?: (cmd: string, argv: string[], cwd: string) => Promise<CmdResult>;
  registry?: Record<string, ToolSpec<any>>;
  registryDeps?: Parameters<typeof createToolRegistry>[0];
  humanReview?: HumanReviewFn;
  requestPlanChangeReview?: PlanChangeReviewFn;
  onEvent?: (event: AgentEvent) => void;
}): Promise<{ ok: boolean; summary: string; auditPath?: string; patchPaths?: string[]; state: AgentState }> => {
  const provider = args.provider ?? getProviderFromEnv();
  const runCmdImpl = args.runCmdImpl ?? runCmd;
  const maxTurns = args.maxTurns ?? 16;
  const maxToolCallsPerTurn = args.maxToolCallsPerTurn ?? 4;
  const maxPatches = args.maxPatches ?? 8;
  const truncation = args.truncation ?? "auto";
  const compactionThreshold = args.compactionThreshold;

  const discovered = args.registry ? null : await loadToolRegistryWithDocs(args.registryDeps);
  const registry = args.registry ?? discovered?.registry ?? (await createToolRegistry(args.registryDeps));
  const policy =
    args.policy ??
    defaultAgentPolicy({
      maxSteps: maxTurns,
      maxActionsPerTask: maxToolCallsPerTurn,
      maxRetriesPerTask: 3,
      maxReplans: 3,
      allowedTools: Object.keys(registry)
    });

  const state: AgentState = {
    goal: args.goal,
    specPath: args.specPath,
    outDir: args.outDir,
    flags: {
      apply: args.apply,
      verify: args.verify,
      repair: args.repair,
      truncation,
      compactionThreshold
    },
    status: "planning",
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
    humanReviews: [],
    lastDeterministicFixes: [],
    repairKnownChecked: false,
    touchedFiles: [],
    toolCalls: [],
    toolResults: [],
    planHistory: []
  };

  const ctx: ToolRunContext = {
    provider,
    runCmdImpl,
    flags: {
      apply: state.flags.apply,
      verify: state.flags.verify,
      repair: state.flags.repair,
      maxPatchesPerTurn: maxPatches
    },
    memory: {
      specPath: state.specPath,
      outDir: state.outDir,
      patchPaths: [],
      touchedPaths: []
    }
  };

  const audit = new AgentTurnAuditCollector(args.goal);

  await runPlanFirstAgent({
    state,
    provider,
    registry,
    ctx,
    maxTurns,
    maxToolCallsPerTurn,
    audit,
    policy,
    humanReview: args.humanReview,
    requestPlanChangeReview: args.requestPlanChangeReview,
    onEvent: args.onEvent
  });

  const base = state.appDir ?? state.outDir;
  const auditPath = await audit.flush(base, {
    ok: state.status === "done",
    verifyHistory: state.verifyHistory,
    patchPaths: state.patchPaths,
    touchedFiles: state.touchedFiles.slice(-200),
    budgets: state.budgets,
    lastError: state.lastError,
    status: state.status,
    policy,
    toolIndex: renderToolIndex(registry)
  });

  if (state.status === "done") {
    args.onEvent?.({ type: "done", auditPath });
    return {
      ok: true,
      summary: "Agent completed successfully",
      auditPath,
      patchPaths: state.patchPaths,
      state
    };
  }

  const message = state.lastError?.message ?? "max turns reached";
  args.onEvent?.({ type: "failed", message, auditPath });
  return {
    ok: false,
    summary: message,
    auditPath,
    patchPaths: state.patchPaths,
    state
  };
};
