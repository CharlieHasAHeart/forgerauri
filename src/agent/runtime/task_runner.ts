import type { LlmProvider } from "../../llm/provider.js";
import type { PlanTask } from "../plan/schema.js";
import type { AgentPolicy } from "../policy/policy.js";
import type { AgentState } from "../types.js";
import type { ToolRunContext, ToolSpec } from "../tools/types.js";
import type { AgentTurnAuditCollector } from "../../runtime/audit/index.js";
import type { HumanReviewFn } from "./executor.js";
import type { AgentEvent } from "./events.js";
import { handleReplan, type PlanChangeReviewFn } from "./replanner.js";
import { runTaskAttempt } from "./task_attempt.js";
import { requiredInput } from "./util.js";

export const runTaskWithRetries = async (args: {
  turn: number;
  task: PlanTask;
  state: AgentState;
  provider: LlmProvider;
  registry: Record<string, ToolSpec<any>>;
  ctx: ToolRunContext;
  maxToolCallsPerTurn: number;
  audit: AgentTurnAuditCollector;
  policy: AgentPolicy;
  completed: Set<string>;
  taskFailures: Map<string, string[]>;
  replans: number;
  humanReview?: HumanReviewFn;
  requestPlanChangeReview: PlanChangeReviewFn;
  onEvent?: (event: AgentEvent) => void;
}): Promise<{ ok: boolean; replans: number }> => {
  const isFailed = (): boolean => args.state.status === "failed";

  args.state.status = "executing";
  args.state.currentTaskId = args.task.id;
  args.onEvent?.({ type: "task_selected", taskId: args.task.id });

  let attempts = 0;
  let taskDone = false;
  let replans = args.replans;
  const currentPlan = requiredInput(args.state.planData, "plan missing in plan mode");

  while (!taskDone && attempts < args.policy.budgets.max_retries_per_task) {
    attempts += 1;
    const recentFailures = args.taskFailures.get(args.task.id) ?? [];
    const attemptResult = await runTaskAttempt({
      turn: args.turn,
      goal: args.state.goal,
      provider: args.provider,
      policy: args.policy,
      task: args.task,
      currentPlan,
      completed: args.completed,
      recentFailures,
      state: args.state,
      registry: args.registry,
      ctx: args.ctx,
      maxToolCallsPerTurn: args.maxToolCallsPerTurn,
      audit: args.audit,
      humanReview: args.humanReview,
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

    args.onEvent?.({ type: "criteria_result", ok: false, failures: attemptResult.failures });
    args.taskFailures.set(args.task.id, attemptResult.failures);

    if (attempts >= args.policy.budgets.max_retries_per_task) {
      const replanned = await handleReplan({
        provider: args.provider,
        state: args.state,
        policy: args.policy,
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
