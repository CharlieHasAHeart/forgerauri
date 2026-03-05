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

export type CoreRunRequest = {
  goal: string;
  specPath: string;
  modelHint?: string;
};

export type CoreRunRuntime = {
  outDir: string;
  runtimeRepoRoot?: string;
  runtimePathsResolver?: RuntimePathsResolver;
  maxTurns?: number;
  maxToolCallsPerTurn?: number;
  maxPatches?: number;
  truncation?: "auto" | "disabled";
  compactionThreshold?: number;
};

export type CoreRunDeps = {
  policy: AgentPolicy;
  registry: Record<string, ToolSpec<any>>;
  llm: LlmPort;
  commandRunner: CommandRunnerPort;
  planner?: Planner;
  audit?: AgentTurnAuditCollector;
  humanReview?: HumanReviewPort;
  middlewares?: KernelMiddleware[];
  hooks?: KernelHooks;
  renderToolIndex?: (registry: Record<string, ToolSpec<any>>) => string;
  onEvent?: (event: AgentEvent) => void;
};

export const runCoreAgent = async (args: {
  request: CoreRunRequest;
  runtime: CoreRunRuntime;
  deps: CoreRunDeps;
}): Promise<CoreRunAgentResult> => {
  const { request, runtime, deps } = args;
  const maxTurns = runtime.maxTurns ?? 16;
  const maxToolCallsPerTurn = runtime.maxToolCallsPerTurn ?? 4;
  const maxPatches = runtime.maxPatches ?? 8;
  const truncation = runtime.truncation ?? "auto";
  const compactionThreshold = runtime.compactionThreshold;
  const onEvent = deps.onEvent ?? deps.humanReview?.onEvent;

  const state: AgentState = {
    goal: request.goal,
    specPath: request.specPath,
    outDir: runtime.outDir,
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
    provider: deps.llm,
    runCmdImpl: deps.commandRunner,
    flags: {
      maxPatchesPerTurn: maxPatches
    },
    memory: {
      repoRoot: runtime.runtimeRepoRoot ?? process.cwd(),
      specPath: state.specPath,
      outDir: state.outDir,
      patchPaths: [],
      touchedPaths: []
    }
  };

  const runtimePathsResolver = runtime.runtimePathsResolver ?? defaultGetRuntimePaths;
  const initialRuntimePaths = runtimePathsResolver(ctx, state);
  ctx.memory.runtimePaths = initialRuntimePaths;
  ctx.memory.appDir = initialRuntimePaths.appDir;
  ctx.memory.tauriDir = initialRuntimePaths.tauriDir;
  state.runtimePaths = initialRuntimePaths;
  state.appDir = initialRuntimePaths.appDir;

  const audit = deps.audit ?? new AgentTurnAuditCollector(request.goal);
  await audit.start(state.outDir, {
    specPath: state.specPath,
    outDir: state.outDir,
    providerName: deps.llm.name,
    model: request.modelHint,
    truncation: state.flags.truncation,
    compactionThreshold: state.flags.compactionThreshold
  });

  const installed = await applyMiddlewares({
    middlewares: deps.middlewares,
    ctx,
    state,
    registry: deps.registry,
    provider: deps.llm,
    hooks: deps.hooks
  });
  ctx.provider = installed.provider;

  let runError: unknown;
  try {
    await runPlanFirstAgent({
      state,
      provider: installed.provider,
      planner: deps.planner ?? noopPlanner,
      registry: installed.registry,
      ctx,
      maxTurns,
      maxToolCallsPerTurn,
      audit,
      policy: deps.policy,
      humanReview: deps.humanReview?.humanReview,
      requestPlanChangeReview: deps.humanReview?.requestPlanChangeReview,
      onEvent,
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
    policy: deps.policy,
    toolIndex: deps.renderToolIndex ? deps.renderToolIndex(installed.registry) : ""
  });

  if (runError) {
    throw runError;
  }

  if (state.status === "done") {
    onEvent?.({ type: "done", auditPath });
    return {
      ok: true,
      summary: "Agent completed successfully",
      auditPath,
      patchPaths: state.patchPaths,
      state
    };
  }

  const message = state.lastError?.message ?? "max turns reached";
  onEvent?.({ type: "failed", message, auditPath });
  return {
    ok: false,
    summary: message,
    auditPath,
    patchPaths: state.patchPaths,
    state
  };
};

export const runAgent = async (args: CoreRunAgentArgs): Promise<CoreRunAgentResult> => {
  return runCoreAgent({
    request: {
      goal: args.goal,
      specPath: args.specPath,
      modelHint: args.modelHint
    },
    runtime: {
      outDir: args.outDir,
      runtimeRepoRoot: args.runtimeRepoRoot,
      runtimePathsResolver: args.runtimePathsResolver,
      maxTurns: args.maxTurns,
      maxToolCallsPerTurn: args.maxToolCallsPerTurn,
      maxPatches: args.maxPatches,
      truncation: args.truncation,
      compactionThreshold: args.compactionThreshold
    },
    deps: {
      policy: args.policy,
      registry: args.registry,
      llm: args.llm,
      commandRunner: args.commandRunner,
      planner: args.planner,
      audit: args.audit,
      humanReview: args.humanReview,
      middlewares: args.middlewares,
      hooks: args.hooks,
      renderToolIndex: args.renderToolIndex,
      onEvent: args.onEvent
    }
  });
};
