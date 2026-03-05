import type { LlmPort } from "../../contracts/llm.js";
import type { PlanTask, Planner } from "../../contracts/planning.js";
import type { AgentPolicy } from "../../contracts/policy.js";
import type { RuntimePathsResolver } from "../../contracts/runtime.js";
import type { AgentState } from "../../contracts/state.js";
import type { ToolRunContext, ToolSpec } from "../../contracts/tools.js";
import type { KernelHooks } from "../../contracts/hooks.js";
import type { Workspace } from "../../contracts/workspace.js";
import type { AgentTurnAuditCollector } from "../telemetry/audit.js";
import { setUsedTurn } from "../runtime/budgets.js";
import type { PlanChangeReviewFn } from "../contracts.js";
import { setStateError } from "../execution/errors.js";
import type { AgentEvent } from "../telemetry/events.js";
import { runTaskWithRetries } from "./task_runner.js";
import { requiredInput, getNextReadyTask } from "../util/util.js";
import { ContextEngine } from "../../context_engine/ContextEngine.js";

export const runTurn = async (args: {
  turn: number;
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
  hooks?: KernelHooks;
  completed: Set<string>;
  taskFailures: Map<string, string[]>;
  replans: number;
  requestPlanChangeReview: PlanChangeReviewFn;
  contextEngine: ContextEngine;
  workspace: Workspace;
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

  if (!args.state.appDir) {
    args.state.status = "failed";
    setStateError(args.state, "Config", "Base root 'appDir' is not available");
    return { status: "failed", replans: args.replans };
  }

  const taskRun = await runTaskWithRetries({
    turn: args.turn,
    task: nextTask as PlanTask,
    state: args.state,
    provider: args.provider,
    planner: args.planner,
    registry: args.registry,
    ctx: args.ctx,
    maxToolCallsPerTurn: args.maxToolCallsPerTurn,
    audit: args.audit,
    policy: args.policy,
    runtimePathsResolver: args.runtimePathsResolver,
    hooks: args.hooks,
    completed: args.completed,
    taskFailures: args.taskFailures,
    replans: args.replans,
    requestPlanChangeReview: args.requestPlanChangeReview,
    contextEngine: args.contextEngine,
    workspace: args.workspace,
    onEvent: args.onEvent
  });

  const replans = taskRun.replans;
  if (args.state.status === "failed" || !taskRun.ok) {
    return { status: "failed", replans };
  }

  if (args.completed.size === currentPlan.tasks.length) {
    args.state.status = "done";
    return { status: "done", replans };
  }

  return { status: "continue", replans };
};
