import type { LlmProvider } from "../../llm/provider.js";
import { getNextReadyTask } from "../plan/selectors.js";
import type { PlanTask } from "../plan/schema.js";
import type { AgentPolicy } from "../policy/policy.js";
import type { AgentState } from "../types.js";
import type { ToolRunContext, ToolSpec } from "../tools/types.js";
import type { AgentTurnAuditCollector } from "../../runtime/audit/index.js";
import { setUsedTurn } from "./budgets.js";
import type { HumanReviewFn } from "./executor.js";
import { setStateError } from "./errors.js";
import type { AgentEvent } from "./events.js";
import type { PlanChangeReviewFn } from "./replanner.js";
import { runTaskWithRetries } from "./task_runner.js";
import { requiredInput } from "./util.js";

export const runTurn = async (args: {
  turn: number;
  state: AgentState;
  provider: LlmProvider;
  registry: Record<string, ToolSpec<any>>;
  ctx: ToolRunContext;
  maxTurns: number;
  maxToolCallsPerTurn: number;
  audit: AgentTurnAuditCollector;
  policy: AgentPolicy;
  completed: Set<string>;
  taskFailures: Map<string, string[]>;
  replans: number;
  humanReview?: HumanReviewFn;
  requestPlanChangeReview: PlanChangeReviewFn;
  onEvent?: (event: AgentEvent) => void;
}): Promise<{ status: "continue" | "done" | "failed"; replans: number }> => {
  setUsedTurn(args.state, args.turn);
  args.onEvent?.({ type: "turn_start", turn: args.turn, maxTurns: args.maxTurns });
  const currentPlan = requiredInput(args.state.planData, "plan missing in plan mode");
  const nextTask = getNextReadyTask(currentPlan, args.completed);

  if (!nextTask) {
    if (args.completed.size === currentPlan.tasks.length) {
      args.state.status = "done";
      return { status: "done", replans: args.replans };
    }
    args.state.status = "failed";
    setStateError(args.state, "Config", "No executable task found (dependency cycle or invalid plan)");
    return { status: "failed", replans: args.replans };
  }

  const taskRun = await runTaskWithRetries({
    turn: args.turn,
    task: nextTask as PlanTask,
    state: args.state,
    provider: args.provider,
    registry: args.registry,
    ctx: args.ctx,
    maxToolCallsPerTurn: args.maxToolCallsPerTurn,
    audit: args.audit,
    policy: args.policy,
    completed: args.completed,
    taskFailures: args.taskFailures,
    replans: args.replans,
    humanReview: args.humanReview,
    requestPlanChangeReview: args.requestPlanChangeReview,
    onEvent: args.onEvent
  });

  const replans = taskRun.replans;
  if (args.state.status === "failed" || !taskRun.ok) {
    return { status: "failed", replans };
  }

  return { status: "continue", replans };
};
