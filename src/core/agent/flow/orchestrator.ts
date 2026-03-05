import type { AgentPolicy } from "../../contracts/policy.js";
import type { AgentState } from "../../contracts/state.js";
import type { LlmPort } from "../../contracts/llm.js";
import type { Planner } from "../../contracts/planning.js";
import type { RuntimePathsResolver } from "../../contracts/runtime.js";
import type { ToolRunContext, ToolSpec } from "../../contracts/tools.js";
import type { KernelHooks } from "../../contracts/hooks.js";
import type { Workspace } from "../../contracts/workspace.js";
import type { AgentTurnAuditCollector } from "../telemetry/audit.js";
import { recordPlanProposed } from "../telemetry/recorder.js";
import type { PlanChangeReviewFn } from "../contracts.js";
import type { AgentEvent } from "../telemetry/events.js";
import { runTurn } from "./turn.js";
import { preflightRuntime } from "../runtime/preflight.js";
import { ContextEngine } from "../../context_engine/ContextEngine.js";
import { serializeContextPacket } from "../../contracts/context.js";
import { storeBlob } from "../../utils/blobStore.js";

export const runPlanFirstAgent = async (args: {
  state: AgentState;
  provider: LlmPort;
  planner: Planner;
  registry: Record<string, ToolSpec<any>>;
  ctx: ToolRunContext;
  maxTurns: number;
  maxToolCallsPerTurn: number;
  audit: AgentTurnAuditCollector;
  policy: AgentPolicy;
  runtimePathsResolver: RuntimePathsResolver;
  workspace: Workspace;
  contextEngine: ContextEngine;
  hooks?: KernelHooks;
  requestPlanChangeReview?: PlanChangeReviewFn;
  onEvent?: (event: AgentEvent) => void;
}): Promise<void> => {
  const { state, provider, planner, registry, ctx, maxTurns, maxToolCallsPerTurn, audit, policy } = args;
  const isTerminal = (): boolean => state.status === "failed" || state.status === "done";
  const requestPlanChangeReview: PlanChangeReviewFn =
    args.requestPlanChangeReview ??
    (async () =>
      "I do not approve this plan change. Please propose a plan change that fixes the failure without relaxing acceptance or changing tech stack.");

  state.status = "planning";

  const planContext = await args.contextEngine.buildContextPacket({
    phase: "planning",
    turn: 0,
    state,
    ctx,
    registry,
    policy,
    workspace: args.workspace
  });
  const planRawContext = serializeContextPacket(planContext);
  const planContextRef = storeBlob(ctx, planRawContext, "context");
  const planProposal = await planner.proposePlan({
    context: planContext,
    registry,
    policy
  });

  state.lastResponseId = planProposal.responseId ?? state.lastResponseId;
  state.usedLLM = true;
  state.planData = planProposal.plan;
  state.planVersion = 1;
  state.completedTasks = [];
  state.planHistory = [{ type: "initial", version: 1, plan: planProposal.plan }];

  recordPlanProposed({
    audit,
    llmRaw: planProposal.raw,
    contextPacketRef: planContextRef,
    previousResponseIdSent: planProposal.previousResponseIdSent,
    responseId: planProposal.responseId,
    usage: planProposal.usage,
    taskCount: planProposal.plan.tasks.length
  });
  args.onEvent?.({ type: "plan_proposed", taskCount: planProposal.plan.tasks.length });

  const runtimePaths = args.runtimePathsResolver(ctx, state);
  ctx.memory.runtimePaths = runtimePaths;
  ctx.memory.repoRoot = runtimePaths.repoRoot;
  ctx.memory.appDir = runtimePaths.appDir;
  ctx.memory.tauriDir = runtimePaths.tauriDir;
  state.runtimePaths = runtimePaths;
  state.appDir = runtimePaths.appDir;

  preflightRuntime({ state, ctx });

  const completed = new Set<string>();
  const taskFailures = new Map<string, string[]>();
  let replans = 0;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const turnResult = await runTurn({
      turn,
      state,
      provider,
      planner,
      registry,
      ctx,
      maxTurns,
      maxToolCallsPerTurn,
      audit,
      policy,
      runtimePathsResolver: args.runtimePathsResolver,
      hooks: args.hooks,
      completed,
      taskFailures,
      replans,
      requestPlanChangeReview,
      onEvent: args.onEvent,
      contextEngine: args.contextEngine,
      workspace: args.workspace
    });
    replans = turnResult.replans;
    if (turnResult.status === "done" || turnResult.status === "failed") break;
  }

  if (!isTerminal()) {
    state.status = "failed";
    state.lastError = state.lastError ?? { kind: "Unknown", message: "max turns reached" };
  }
};
