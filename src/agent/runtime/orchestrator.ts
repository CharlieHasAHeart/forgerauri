// Orchestrates the plan-first loop: Plan -> Execute -> Review -> Replan.
import { proposePlan, proposeTaskActionPlan } from "../planning/planner.js";
import { PLAN_INSTRUCTIONS } from "../planning/prompts.js";
import { renderToolIndex } from "../planning/tool_index.js";
import { getNextReadyTask, summarizePlan } from "../plan/selectors.js";
import type { PlanTask } from "../plan/schema.js";
import type { AgentPolicy } from "../policy/policy.js";
import type { AgentState } from "../types.js";
import type { LlmProvider } from "../../llm/provider.js";
import type { ToolRunContext, ToolSpec } from "../tools/types.js";
import type { AgentTurnAuditCollector } from "./audit.js";
import { setUsedTurn } from "./budgets.js";
import { setStateError } from "./errors.js";
import { recordPlanProposed, recordTaskActionPlan } from "./recorder.js";
import { summarizeState } from "./state.js";
import { executeActionPlan, type HumanReviewFn } from "./executor.js";
import { handleReplan, type PlanChangeReviewFn } from "./replanner.js";

const requiredInput = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
};

export const runPlanFirstAgent = async (args: {
  state: AgentState;
  provider: LlmProvider;
  registry: Record<string, ToolSpec<any>>;
  ctx: ToolRunContext;
  maxTurns: number;
  maxToolCallsPerTurn: number;
  audit: AgentTurnAuditCollector;
  policy: AgentPolicy;
  humanReview?: HumanReviewFn;
  requestPlanChangeReview?: PlanChangeReviewFn;
}): Promise<void> => {
  const { state, provider, registry, ctx, maxTurns, maxToolCallsPerTurn, audit, policy } = args;
  const requestPlanChangeReview: PlanChangeReviewFn =
    args.requestPlanChangeReview ??
    (async () =>
      "I do not approve this plan change. Please propose a plan change that fixes the failure without relaxing acceptance or changing tech stack.");
  state.status = "planning";

  const planProposal = await proposePlan({
    goal: state.goal,
    provider,
    registry,
    stateSummary: summarizeState(state),
    policy,
    maxToolCallsPerTurn,
    instructions: PLAN_INSTRUCTIONS,
    previousResponseId: state.lastResponseId,
    truncation: state.flags.truncation,
    contextManagement:
      typeof state.flags.compactionThreshold === "number"
        ? [{ type: "compaction", compactThreshold: state.flags.compactionThreshold }]
        : undefined
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
    previousResponseIdSent: planProposal.previousResponseIdSent,
    responseId: planProposal.responseId,
    usage: planProposal.usage,
    taskCount: planProposal.plan.tasks.length
  });

  const completed = new Set<string>();
  const taskFailures = new Map<string, string[]>();
  let replans = 0;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    setUsedTurn(state, turn);
    const currentPlan = requiredInput(state.planData, "plan missing in plan mode");
    const nextTask = getNextReadyTask(currentPlan, completed);

    if (!nextTask) {
      if (completed.size === currentPlan.tasks.length) {
        state.status = "done";
        state.phase = "DONE";
        break;
      }
      state.status = "failed";
      state.phase = "FAILED";
      setStateError(state, "Config", "No executable task found (dependency cycle or invalid plan)");
      break;
    }

    state.status = "executing";
    state.currentTaskId = nextTask.id;

    let taskDone = false;
    let attempts = 0;

    while (!taskDone && attempts < policy.budgets.max_retries_per_task) {
      attempts += 1;
      const actionPlan = await proposeTaskActionPlan({
        goal: state.goal,
        provider,
        policy,
        task: nextTask,
        planSummary: summarizePlan(currentPlan),
        stateSummary: {
          ...(summarizeState(state) as Record<string, unknown>),
          currentTask: nextTask
        },
        toolIndex: renderToolIndex(registry),
        recentFailures: taskFailures.get(nextTask.id) ?? [],
        previousResponseId: state.lastResponseId,
        instructions:
          "Plan mode task execution: return TaskActionPlanV1 JSON for this task only. Do not modify global plan here.",
        truncation: state.flags.truncation,
        contextManagement:
          typeof state.flags.compactionThreshold === "number"
            ? [{ type: "compaction", compactThreshold: state.flags.compactionThreshold }]
            : undefined
      });
      state.lastResponseId = actionPlan.responseId ?? state.lastResponseId;

      let toolCalls = actionPlan.actionPlan.actions.map((item) => ({ name: item.name, input: item.input }));
      toolCalls = toolCalls.slice(0, Math.min(maxToolCallsPerTurn, policy.budgets.max_actions_per_task));
      state.status = "executing";

      const executed = await executeActionPlan({
        toolCalls,
        actionPlanActions: actionPlan.actionPlan.actions,
        registry,
        ctx,
        state,
        policy,
        humanReview: args.humanReview,
        task: nextTask as PlanTask
      });

      recordTaskActionPlan({
        audit,
        turn,
        taskId: nextTask.id,
        llmRaw: actionPlan.raw,
        previousResponseIdSent: actionPlan.previousResponseIdSent,
        responseId: actionPlan.responseId,
        usage: actionPlan.usage,
        toolCalls,
        toolResults: executed.turnAuditResults
      });

      if (executed.criteria.ok) {
        completed.add(nextTask.id);
        state.completedTasks = Array.from(completed);
        taskDone = true;
        continue;
      }

      taskFailures.set(nextTask.id, executed.criteria.failures);

      if (attempts >= policy.budgets.max_retries_per_task) {
        const replanned = await handleReplan({
          provider,
          state,
          policy,
          failedTaskId: nextTask.id,
          failures: executed.criteria.failures,
          replans,
          audit,
          turn,
          requestPlanChangeReview
        });
        replans = replanned.replans;
        if (!replanned.ok) {
          break;
        }
      }
    }

    if (state.phase === "FAILED") break;
  }

  if (state.status !== "failed" && state.status !== "done") {
    state.status = "failed";
    state.phase = "FAILED";
    state.lastError = state.lastError ?? { kind: "Unknown", message: "max turns reached" };
  }
};
