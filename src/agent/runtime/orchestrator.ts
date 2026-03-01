// Orchestrates the plan-first loop: Plan -> Execute -> Review -> Replan.
import { proposePlan } from "../planning/planner.js";
import { PLAN_INSTRUCTIONS } from "../planning/prompts.js";
import type { AgentPolicy } from "../policy/policy.js";
import type { AgentState } from "../types.js";
import type { LlmProvider } from "../../llm/provider.js";
import type { ToolRunContext, ToolSpec } from "../tools/types.js";
import type { AgentTurnAuditCollector } from "../../runtime/audit/index.js";
import { recordPlanProposed } from "./recorder.js";
import { summarizeState } from "./state.js";
import type { HumanReviewFn } from "./executor.js";
import type { PlanChangeReviewFn } from "./replanner.js";
import type { AgentEvent } from "./events.js";
import { runTurn } from "./turn.js";

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
  const isTerminal = (): boolean => state.status === "failed" || state.status === "done";
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
    const turnResult = await runTurn({
      turn,
      state,
      provider,
      registry,
      ctx,
      maxTurns,
      maxToolCallsPerTurn,
      audit,
      policy,
      completed,
      taskFailures,
      replans,
      humanReview: args.humanReview,
      requestPlanChangeReview,
      onEvent: args.onEvent
    });
    replans = turnResult.replans;
    if (turnResult.status === "done" || turnResult.status === "failed") break;
  }

  if (!isTerminal()) {
    state.status = "failed";
    state.lastError = state.lastError ?? { kind: "Unknown", message: "max turns reached" };
  }
};
