import { AgentTurnAuditCollector } from "../telemetry/audit.js";
import { runPlanFirstAgent } from "./orchestrator.js";
import { defaultGetRuntimePaths } from "../../runtime_paths/getRuntimePaths.js";
import type { AgentEvent } from "../telemetry/events.js";
import type { ToolRunContext, ToolSpec } from "../../contracts/tools.js";
import type { AgentState } from "../../contracts/state.js";
import type { AgentPolicy } from "../../contracts/policy.js";
import type { CommandRunnerPort, RuntimePathsResolver } from "../../contracts/runtime.js";
import type { HumanReviewPort } from "../contracts.js";
import type { LlmPort } from "../../contracts/llm.js";
import type { Planner } from "../../contracts/planning.js";
import type { KernelHooks } from "../../contracts/hooks.js";
import { noopPlanner } from "../../defaults/noopPlanner.js";
import { applyMiddlewares } from "../../middleware/applyMiddlewares.js";
import type { KernelMiddleware } from "../../middleware/types.js";

export type CoreRunAgentArgs = {
  goal: string;
  specPath: string;
  outDir: string;
  maxTurns?: number;
  maxToolCallsPerTurn?: number;
  maxPatches?: number;
  truncation?: "auto" | "disabled";
  compactionThreshold?: number;
  policy: AgentPolicy;
  registry: Record<string, ToolSpec<any>>;
  llm: LlmPort;
  commandRunner: CommandRunnerPort;
  planner?: Planner;
  audit?: AgentTurnAuditCollector;
  humanReview?: HumanReviewPort;
  modelHint?: string;
  runtimeRepoRoot?: string;
  runtimePathsResolver?: RuntimePathsResolver;
  middlewares?: KernelMiddleware[];
  hooks?: KernelHooks;
  renderToolIndex?: (registry: Record<string, ToolSpec<any>>) => string;
  onEvent?: (event: AgentEvent) => void;
};

export type CoreRunAgentResult = {
  ok: boolean;
  summary: string;
  auditPath?: string;
  patchPaths?: string[];
  state: AgentState;
};

export const runAgent = async (args: CoreRunAgentArgs): Promise<CoreRunAgentResult> => {
  const maxTurns = args.maxTurns ?? 16;
  const maxToolCallsPerTurn = args.maxToolCallsPerTurn ?? 4;
  const maxPatches = args.maxPatches ?? 8;
  const truncation = args.truncation ?? "auto";
  const compactionThreshold = args.compactionThreshold;

  const state: AgentState = {
    goal: args.goal,
    specPath: args.specPath,
    outDir: args.outDir,
    flags: {
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
    provider: args.llm,
    runCmdImpl: args.commandRunner,
    flags: {
      maxPatchesPerTurn: maxPatches
    },
    memory: {
      repoRoot: args.runtimeRepoRoot ?? process.cwd(),
      specPath: state.specPath,
      outDir: state.outDir,
      patchPaths: [],
      touchedPaths: []
    }
  };

  const runtimePathsResolver = args.runtimePathsResolver ?? defaultGetRuntimePaths;
  const initialRuntimePaths = runtimePathsResolver(ctx, state);
  ctx.memory.runtimePaths = initialRuntimePaths;
  ctx.memory.appDir = initialRuntimePaths.appDir;
  ctx.memory.tauriDir = initialRuntimePaths.tauriDir;
  state.runtimePaths = initialRuntimePaths;
  state.appDir = initialRuntimePaths.appDir;

  const audit = args.audit ?? new AgentTurnAuditCollector(args.goal);
  await audit.start(state.outDir, {
    specPath: state.specPath,
    outDir: state.outDir,
    providerName: args.llm.name,
    model: args.modelHint,
    truncation: state.flags.truncation,
    compactionThreshold: state.flags.compactionThreshold
  });

  const installed = await applyMiddlewares({
    middlewares: args.middlewares,
    ctx,
    state,
    registry: args.registry,
    provider: args.llm,
    hooks: args.hooks
  });
  ctx.provider = installed.provider;

  let runError: unknown;
  try {
    await runPlanFirstAgent({
      state,
      provider: installed.provider,
      planner: args.planner ?? noopPlanner,
      registry: installed.registry,
      ctx,
      maxTurns,
      maxToolCallsPerTurn,
      audit,
      policy: args.policy,
      humanReview: args.humanReview?.humanReview,
      requestPlanChangeReview: args.humanReview?.requestPlanChangeReview,
      onEvent: args.onEvent ?? args.humanReview?.onEvent,
      runtimePathsResolver,
      hooks: installed.hooks
    });
  } catch (error) {
    runError = error;
    state.status = "failed";
    state.lastError = state.lastError ?? {
      kind: "Unknown",
      message: error instanceof Error ? error.message : "Unknown error"
    };
  }

  const base = state.appDir ?? state.outDir;
  const auditPath = await audit.flush(base, {
    ok: state.status === "done",
    verifyHistory: state.verifyHistory,
    patchPaths: state.patchPaths,
    touchedFiles: state.touchedFiles.slice(-200),
    budgets: state.budgets,
    lastError: state.lastError,
    status: state.status,
    policy: args.policy,
    toolIndex: args.renderToolIndex ? args.renderToolIndex(installed.registry) : ""
  });

  if (runError) {
    throw runError;
  }

  if (state.status === "done") {
    (args.onEvent ?? args.humanReview?.onEvent)?.({ type: "done", auditPath });
    return {
      ok: true,
      summary: "Agent completed successfully",
      auditPath,
      patchPaths: state.patchPaths,
      state
    };
  }

  const message = state.lastError?.message ?? "max turns reached";
  (args.onEvent ?? args.humanReview?.onEvent)?.({ type: "failed", message, auditPath });
  return {
    ok: false,
    summary: message,
    auditPath,
    patchPaths: state.patchPaths,
    state
  };
};
