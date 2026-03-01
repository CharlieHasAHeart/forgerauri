import type { LlmProvider } from "../../llm/provider.js";
import type { PlanTask, PlanV1 } from "../plan/schema.js";
import { summarizePlan } from "../plan/selectors.js";
import { proposeToolCallsForTask } from "../planning/tool_call_planner.js";
import type { AgentPolicy } from "../policy/policy.js";
import type { AgentState } from "../types.js";
import type { ToolRunContext, ToolSpec } from "../tools/types.js";
import type { AgentTurnAuditCollector } from "../../runtime/audit/index.js";
import { executeActionPlan, type HumanReviewFn } from "./executor.js";
import { setStateError } from "./errors.js";
import type { AgentEvent } from "./events.js";
import { recordTaskActionPlan } from "./recorder.js";
import { summarizeState } from "./state.js";
import { gateToolCalls } from "./toolcall_gate.js";

export const runTaskAttempt = async (args: {
  turn: number;
  goal: string;
  provider: LlmProvider;
  policy: AgentPolicy;
  task: PlanTask;
  currentPlan: PlanV1;
  completed: Set<string>;
  recentFailures: string[];
  state: AgentState;
  registry: Record<string, ToolSpec<any>>;
  ctx: ToolRunContext;
  maxToolCallsPerTurn: number;
  audit: AgentTurnAuditCollector;
  humanReview?: HumanReviewFn;
  onEvent?: (event: AgentEvent) => void;
}): Promise<{
  ok: boolean;
  failures: string[];
  toolCalls: Array<{ name: string; input: unknown }>;
  turnAuditResults: Array<{ name: string; ok: boolean; error?: string; touchedPaths?: string[] }>;
}> => {
  const planSummary = summarizePlan(args.currentPlan);
  const stateSummary = {
    ...(summarizeState(args.state) as Record<string, unknown>),
    currentTask: args.task
  };

  let toolCalls: Array<{ name: string; input: unknown }> = [];
  let plannerRaw = "";
  let plannerResponseId: string | undefined;
  let plannerUsage: unknown;
  let plannerPreviousResponseIdSent: string | undefined;
  const plannerRecentFailures = [...args.recentFailures];

  for (let planTry = 1; planTry <= 2; planTry += 1) {
    try {
      const proposal = await proposeToolCallsForTask({
        goal: args.goal,
        provider: args.provider,
        policy: args.policy,
        task: args.task,
        planSummary,
        stateSummary,
        registry: args.registry,
        recentFailures: plannerRecentFailures,
        maxToolCallsPerTurn: args.maxToolCallsPerTurn,
        previousResponseId: args.state.lastResponseId,
        truncation: args.state.flags.truncation,
        contextManagement:
          typeof args.state.flags.compactionThreshold === "number"
            ? [{ type: "compaction", compactThreshold: args.state.flags.compactionThreshold }]
            : undefined
      });
      plannerRaw = proposal.raw;
      plannerResponseId = proposal.responseId;
      plannerUsage = proposal.usage;
      plannerPreviousResponseIdSent = proposal.previousResponseIdSent;
      args.state.lastResponseId = proposal.responseId ?? args.state.lastResponseId;

      const gated = gateToolCalls({
        toolCalls: proposal.toolCalls,
        maxToolCallsPerTurn: args.maxToolCallsPerTurn,
        policyMaxActionsPerTask: args.policy.budgets.max_actions_per_task
      });
      if (gated.ok) {
        toolCalls = gated.toolCalls;
        break;
      }

      plannerRecentFailures.push(
        "PlannerOutputInvalid: toolCalls must be array of {name,input}. input must be a JSON object (not undefined). Fix and return valid tool calls."
      );

      if (planTry >= 2) {
        args.state.status = "failed";
        setStateError(args.state, "Config", gated.details);
        return {
          ok: false,
          failures: [gated.details],
          toolCalls: [],
          turnAuditResults: []
        };
      }
    } catch (error) {
      const message = `Failed to propose tool calls for task '${args.task.id}': ${
        error instanceof Error ? error.message : "unknown error"
      }`;
      if (planTry >= 2) {
        args.state.status = "failed";
        setStateError(args.state, "Unknown", message);
        return {
          ok: false,
          failures: [message],
          toolCalls: [],
          turnAuditResults: []
        };
      }
      plannerRecentFailures.push(
        "PlannerOutputInvalid: toolCalls must be array of {name,input}. input must be a JSON object (not undefined). Fix and return valid tool calls."
      );
    }
  }

  const actionPlanActions = toolCalls.map((item) => ({ name: item.name }));
  args.state.status = "executing";

  const executed = await executeActionPlan({
    toolCalls,
    actionPlanActions,
    registry: args.registry,
    ctx: args.ctx,
    state: args.state,
    policy: args.policy,
    humanReview: args.humanReview,
    task: args.task,
    onEvent: args.onEvent
  });

  recordTaskActionPlan({
    audit: args.audit,
    turn: args.turn,
    taskId: args.task.id,
    llmRaw: plannerRaw,
    previousResponseIdSent: plannerPreviousResponseIdSent,
    responseId: plannerResponseId,
    usage: plannerUsage,
    toolCalls,
    toolResults: executed.turnAuditResults
  });

  return {
    ok: executed.criteria.ok,
    failures: executed.criteria.failures,
    toolCalls,
    turnAuditResults: executed.turnAuditResults
  };
};
