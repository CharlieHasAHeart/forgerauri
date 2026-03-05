import type { LlmPort } from "../../contracts/llm.js";
import type { PlanTask, Planner } from "../../contracts/planning.js";
import type { AgentPolicy } from "../../contracts/policy.js";
import type { RuntimePathsResolver } from "../../contracts/runtime.js";
import type { AgentState } from "../../contracts/state.js";
import type { ToolRunContext, ToolSpec } from "../../contracts/tools.js";
import type { KernelHooks } from "../../contracts/hooks.js";
import type { Workspace } from "../../contracts/workspace.js";
import type { AgentTurnAuditCollector } from "../telemetry/audit.js";
import type { PlanChangeReviewFn } from "../contracts.js";
import type { AgentEvent } from "../telemetry/events.js";
import { handleReplan } from "./replanner.js";
import { runTaskAttempt } from "./task_attempt.js";
import { classifyFailure } from "../execution/failures.js";
import { setStateError } from "../execution/errors.js";
import { ContextEngine } from "../../context_engine/ContextEngine.js";

export const runTaskWithRetries = async (args: {
  turn: number;
  task: PlanTask;
  state: AgentState;
  provider: LlmPort;
  planner: Planner;
  registry: Record<string, ToolSpec<any>>;
  ctx: ToolRunContext;
  maxToolCallsPerTurn: number;
  audit: AgentTurnAuditCollector;
  policy: AgentPolicy;
  runtimePathsResolver: RuntimePathsResolver;
  hooks?: KernelHooks;
  completed: Set<string>;
  taskFailures: Map<string, string[]>;
  replans: number;
  requestPlanChangeReview: PlanChangeReviewFn;
  contextEngine: ContextEngine;
  workspace: Workspace;
  onEvent?: (event: AgentEvent) => void;
}): Promise<{ ok: boolean; replans: number }> => {
  const isFailed = (): boolean => args.state.status === "failed";

  args.state.status = "executing";
  args.state.currentTaskId = args.task.id;
  args.onEvent?.({ type: "task_selected", taskId: args.task.id });

  let attempts = 0;
  let taskDone = false;
  let replans = args.replans;

  while (!taskDone && attempts < args.policy.budgets.max_retries_per_task) {
    attempts += 1;
    const recentFailures = args.taskFailures.get(args.task.id) ?? [];
    const attemptResult = await runTaskAttempt({
      turn: args.turn,
      planner: args.planner,
      policy: args.policy,
      task: args.task,
      currentPlan: args.state.planData!,
      completed: args.completed,
      recentFailures,
      state: args.state,
      registry: args.registry,
      ctx: args.ctx,
      maxToolCallsPerTurn: args.maxToolCallsPerTurn,
      runtimePathsResolver: args.runtimePathsResolver,
      hooks: args.hooks,
      audit: args.audit,
      contextEngine: args.contextEngine,
      workspace: args.workspace,
      onEvent: args.onEvent
    });

    if (isFailed()) {
      return { ok: false, replans };
    }

    if (attemptResult.ok) {
      args.onEvent?.({ type: "criteria_result", ok: true, failures: [] });
      args.completed.add(args.task.id);
      args.state.completedTasks = Array.from(args.completed);
      taskDone = true;
      continue;
    }

    const signal = classifyFailure({
      criteriaFailures: attemptResult.failures,
      lastErrorMessage: args.state.lastError?.message,
      toolAuditErrors: attemptResult.turnAuditResults.filter((item) => !item.ok && item.error).map((item) => item.error as string)
    });
    const failureForEvent = signal.class === "system" ? [signal.message] : attemptResult.failures;
    args.onEvent?.({ type: "criteria_result", ok: false, failures: failureForEvent });

    if (signal.class === "system") {
      args.state.status = "failed";
      setStateError(args.state, "Config", signal.message);
      return { ok: false, replans };
    }

    args.taskFailures.set(args.task.id, attemptResult.failures);

    if (attempts >= args.policy.budgets.max_retries_per_task) {
      const replanned = await handleReplan({
        provider: args.provider,
        planner: args.planner,
        state: args.state,
        policy: args.policy,
        ctx: args.ctx,
        registry: args.registry,
        workspace: args.workspace,
        contextEngine: args.contextEngine,
        failedTaskId: args.task.id,
        failures: attemptResult.failures,
        replans,
        audit: args.audit,
        turn: args.turn,
        requestPlanChangeReview: args.requestPlanChangeReview,
        onEvent: args.onEvent
      });
      replans = replanned.replans;
      if (!replanned.ok) {
        return { ok: false, replans };
      }
    }
  }

  return { ok: true, replans };
};
