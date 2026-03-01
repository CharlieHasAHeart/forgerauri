// Orchestrates the plan-first loop: Plan -> Execute -> Review -> Replan.
import { proposePlan } from "../planning/planner.js";
import { proposeToolCallsForTask } from "../planning/tool_call_planner.js";
import { PLAN_INSTRUCTIONS } from "../planning/prompts.js";
import { getNextReadyTask, summarizePlan } from "../plan/selectors.js";
import type { PlanTask } from "../plan/schema.js";
import type { AgentPolicy } from "../policy/policy.js";
import type { AgentState } from "../types.js";
import type { LlmProvider } from "../../llm/provider.js";
import type { ToolRunContext, ToolSpec } from "../tools/types.js";
import type { AgentTurnAuditCollector } from "../../runtime/audit/index.js";
import { setUsedTurn } from "./budgets.js";
import { setStateError } from "./errors.js";
import { recordPlanProposed, recordTaskActionPlan } from "./recorder.js";
import { summarizeState } from "./state.js";
import { executeActionPlan, type HumanReviewFn } from "./executor.js";
import { handleReplan, type PlanChangeReviewFn } from "./replanner.js";
import type { AgentEvent } from "./events.js";

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
  onEvent?: (event: AgentEvent) => void;
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
  args.onEvent?.({ type: "plan_proposed", taskCount: planProposal.plan.tasks.length });

  const completed = new Set<string>();
  const taskFailures = new Map<string, string[]>();
  let replans = 0;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    setUsedTurn(state, turn);
    args.onEvent?.({ type: "turn_start", turn, maxTurns });
    const currentPlan = requiredInput(state.planData, "plan missing in plan mode");
    const nextTask = getNextReadyTask(currentPlan, completed);

    if (!nextTask) {
      if (completed.size === currentPlan.tasks.length) {
        state.status = "done";
        break;
      }
      state.status = "failed";
      setStateError(state, "Config", "No executable task found (dependency cycle or invalid plan)");
      break;
    }

    state.status = "executing";
    state.currentTaskId = nextTask.id;
    args.onEvent?.({ type: "task_selected", taskId: nextTask.id });

    let taskDone = false;
    let attempts = 0;

    while (!taskDone && attempts < policy.budgets.max_retries_per_task) {
      attempts += 1;
      const planSummary = summarizePlan(currentPlan);
      const stateSummary = {
        ...(summarizeState(state) as Record<string, unknown>),
        currentTask: nextTask
      };
      const recentFailures = taskFailures.get(nextTask.id) ?? [];

      let toolCalls: Array<{ name: string; input: unknown }> = [];
      let plannerRaw = "";
      let plannerResponseId: string | undefined;
      let plannerUsage: unknown;
      let plannerPreviousResponseIdSent: string | undefined;

      try {
        const proposal = await proposeToolCallsForTask({
          goal: state.goal,
          provider,
          policy,
          task: nextTask,
          planSummary,
          stateSummary,
          registry,
          recentFailures,
          maxToolCallsPerTurn,
          previousResponseId: state.lastResponseId,
          truncation: state.flags.truncation,
          contextManagement:
            typeof state.flags.compactionThreshold === "number"
              ? [{ type: "compaction", compactThreshold: state.flags.compactionThreshold }]
              : undefined
        });
        plannerRaw = proposal.raw;
        plannerResponseId = proposal.responseId;
        plannerUsage = proposal.usage;
        plannerPreviousResponseIdSent = proposal.previousResponseIdSent;
        toolCalls = proposal.toolCalls;
      } catch (error) {
        state.status = "failed";
        setStateError(
          state,
          "Unknown",
          `Failed to propose tool calls for task '${nextTask.id}': ${error instanceof Error ? error.message : "unknown error"}`
        );
        break;
      }

      state.lastResponseId = plannerResponseId ?? state.lastResponseId;

      toolCalls = toolCalls.slice(0, Math.min(maxToolCallsPerTurn, policy.budgets.max_actions_per_task));
      const actionPlanActions = toolCalls.map((item) => ({ name: item.name }));
      state.status = "executing";

      const executed = await executeActionPlan({
        toolCalls,
        actionPlanActions,
        registry,
        ctx,
        state,
        policy,
        humanReview: args.humanReview,
        task: nextTask as PlanTask,
        onEvent: args.onEvent
      });

      recordTaskActionPlan({
        audit,
        turn,
        taskId: nextTask.id,
        llmRaw: plannerRaw,
        previousResponseIdSent: plannerPreviousResponseIdSent,
        responseId: plannerResponseId,
        usage: plannerUsage,
        toolCalls,
        toolResults: executed.turnAuditResults
      });

      if (executed.criteria.ok) {
        args.onEvent?.({ type: "criteria_result", ok: true, failures: [] });
        completed.add(nextTask.id);
        state.completedTasks = Array.from(completed);
        taskDone = true;
        continue;
      }

      args.onEvent?.({ type: "criteria_result", ok: false, failures: executed.criteria.failures });

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
          requestPlanChangeReview,
          onEvent: args.onEvent
        });
        replans = replanned.replans;
        if (!replanned.ok) {
          break;
        }
      }
    }

    if (state.status === "failed") break;
  }

  if (state.status !== "failed" && state.status !== "done") {
    state.status = "failed";
    state.lastError = state.lastError ?? { kind: "Unknown", message: "max turns reached" };
  }
};
