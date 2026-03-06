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
import { evaluateCriteriaSet } from "../execution/criteria.js";
import { handleReplan } from "./replanner.js";

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
  state.planVersion = 2;
  state.completedTasks = [];
  state.planHistory = [{ type: "initial", version: 2, plan: planProposal.plan }];

  const taskCount = planProposal.plan.milestones.reduce((acc, item) => acc + item.tasks.length, 0);
  recordPlanProposed({
    audit,
    llmRaw: planProposal.raw,
    contextPacketRef: planContextRef,
    previousResponseIdSent: planProposal.previousResponseIdSent,
    responseId: planProposal.responseId,
    usage: planProposal.usage,
    taskCount
  });
  args.onEvent?.({ type: "plan_proposed", taskCount });

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
  let turn = 0;

  const runMilestoneTasks = async (): Promise<boolean> => {
    while (true) {
      const milestone = state.planData?.milestones.find((item) => item.id === state.activeMilestoneId);
      const milestoneTasks = milestone?.tasks ?? [];
      if (milestoneTasks.every((task) => completed.has(task.id))) return true;

      turn += 1;
      if (turn > maxTurns) {
        state.status = "failed";
        state.lastError = state.lastError ?? { kind: "Unknown", message: "max turns reached" };
        return false;
      }

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
      if (turnResult.status === "failed") return false;
    }
  };

  milestone_loop: for (const initialMilestone of state.planData.milestones) {
    state.activeMilestoneId = initialMilestone.id;
    if (!(await runMilestoneTasks())) break;

    while (true) {
      const milestone = state.planData?.milestones.find((item) => item.id === state.activeMilestoneId);
      if (!milestone) {
        state.status = "failed";
        state.lastError = { kind: "Config", message: `Milestone ${state.activeMilestoneId} not found` };
        break milestone_loop;
      }

      const review = await evaluateCriteriaSet({
        criteria: milestone.acceptance,
        ctx,
        state,
        policy
      });
      state.milestoneReviewHistory.push({
        milestoneId: milestone.id,
        ok: review.ok,
        failures: review.failures.map((item) => item.note),
        ts: Date.now()
      });

      if (review.ok) break;

      if (replans >= policy.budgets.max_replans) {
        state.status = "failed";
        state.lastError = {
          kind: "Config",
          message: `Milestone review failed and replan budget exceeded for milestone ${milestone.id}`
        };
        break milestone_loop;
      }

      const repair = await handleReplan({
        provider,
        planner,
        state,
        policy,
        ctx,
        registry,
        workspace: args.workspace,
        contextEngine: args.contextEngine,
        failedTaskId: `milestone_review:${milestone.id}`,
        failures: review.failures.map((item) => item.note),
        replans,
        audit: args.audit,
        turn: turn + 1,
        requestPlanChangeReview,
        onEvent: args.onEvent
      });
      replans = repair.replans;
      if (!repair.ok) break milestone_loop;
      if (!(await runMilestoneTasks())) break milestone_loop;
    }
  }

  if (state.status !== "failed") {
    goal_loop: while (true) {
      const goalReview = await evaluateCriteriaSet({
        criteria: state.planData?.goal_acceptance ?? [],
        ctx,
        state,
        policy
      });
      state.goalReviewHistory.push({
        ok: goalReview.ok,
        failures: goalReview.failures.map((item) => item.note),
        ts: Date.now()
      });

      if (goalReview.ok) {
        state.status = "done";
        break;
      }

      if (replans >= policy.budgets.max_replans) {
        state.status = "failed";
        state.lastError = {
          kind: "Config",
          message: "Integration review failed and replan budget exceeded"
        };
        break;
      }

      const lastMilestone = state.planData?.milestones[state.planData.milestones.length - 1];
      state.activeMilestoneId = lastMilestone?.id;

      const repair = await handleReplan({
        provider,
        planner,
        state,
        policy,
        ctx,
        registry,
        workspace: args.workspace,
        contextEngine: args.contextEngine,
        failedTaskId: "goal_review",
        failures: goalReview.failures.map((item) => item.note),
        replans,
        audit: args.audit,
        turn: turn + 1,
        requestPlanChangeReview,
        onEvent: args.onEvent
      });
      replans = repair.replans;
      if (!repair.ok) break goal_loop;

      for (const milestone of state.planData?.milestones ?? []) {
        state.activeMilestoneId = milestone.id;
        if (!(await runMilestoneTasks())) {
          break goal_loop;
        }
      }
    }
  }

  if (!isTerminal()) {
    state.status = "failed";
    state.lastError = state.lastError ?? { kind: "Unknown", message: "max turns reached" };
  }
};
