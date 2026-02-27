// Handles deterministic replan flow: propose change, gate decision, apply patch.
import { evaluatePlanChange } from "../plan/gate.js";
import { applyPlanChangePatch } from "../plan/patch.js";
import type { AgentPolicy } from "../policy/policy.js";
import { proposePlanChange } from "../planning/planner.js";
import { PLAN_INSTRUCTIONS } from "../planning/prompts.js";
import type { AgentState } from "../types.js";
import type { LlmProvider } from "../../llm/provider.js";
import { summarizeState } from "./state.js";
import { setStateError } from "./errors.js";
import { recordPlanChange } from "./recorder.js";
import type { AgentTurnAuditCollector } from "./audit.js";
import { planChangeDecisionSchema, type PlanChangeDecision, type PlanChangeRequestV2 } from "../plan/schema.js";

export type PlanChangeReviewContext = {
  request: PlanChangeRequestV2;
  gateDecision: PlanChangeDecision;
  policySummary?: unknown;
};

export type PlanChangeReviewFn = (ctx: PlanChangeReviewContext) => Promise<PlanChangeDecision>;

export const handleReplan = async (args: {
  provider: LlmProvider;
  state: AgentState;
  policy: AgentPolicy;
  failedTaskId: string;
  failures: string[];
  replans: number;
  audit: AgentTurnAuditCollector;
  turn: number;
  requestPlanChangeReview: PlanChangeReviewFn;
}): Promise<{ ok: boolean; replans: number }> => {
  const { provider, state, policy } = args;
  const currentPlan = state.planData;
  if (!currentPlan) {
    setStateError(state, "Config", "Missing current plan during replan");
    state.status = "failed";
    state.phase = "FAILED";
    return { ok: false, replans: args.replans };
  }

  state.status = "replanning";
  const changeProposal = await proposePlanChange({
    provider,
    goal: state.goal,
    currentPlan,
    policy,
    stateSummary: {
      ...(summarizeState(state) as Record<string, unknown>),
      failedTask: args.failedTaskId,
      failures: args.failures
    },
    failureEvidence: args.failures,
    previousResponseId: state.lastResponseId,
    instructions: PLAN_INSTRUCTIONS,
    truncation: state.flags.truncation,
    contextManagement:
      typeof state.flags.compactionThreshold === "number"
        ? [{ type: "compaction", compactThreshold: state.flags.compactionThreshold }]
        : undefined
  });

  state.lastResponseId = changeProposal.responseId ?? state.lastResponseId;
  state.planHistory?.push({ type: "change_request", request: changeProposal.changeRequest });

  const decision = evaluatePlanChange({
    request: changeProposal.changeRequest,
    policy,
    currentTaskCount: currentPlan.tasks.length
  });

  recordPlanChange({
    audit: args.audit,
    turn: args.turn,
    llmRaw: changeProposal.raw,
    previousResponseIdSent: changeProposal.previousResponseIdSent,
    responseId: changeProposal.responseId,
    usage: changeProposal.usage,
    decision
  });

  if (decision.decision === "denied") {
    state.planHistory?.push({ type: "change_decision", decision });
    state.status = "failed";
    state.phase = "FAILED";
    setStateError(
      state,
      "Config",
      `Plan change denied: ${decision.reason}. Guidance: ${decision.guidance}`
    );
    return { ok: false, replans: args.replans };
  }

  let finalDecision = decision;
  if (decision.decision === "needs_user_review") {
    const reviewed = await args.requestPlanChangeReview({
      request: changeProposal.changeRequest,
      gateDecision: decision,
      policySummary: {
        acceptanceLocked: policy.acceptance.locked,
        techStackLocked: policy.tech_stack_locked,
        allowedTools: policy.safety.allowed_tools
      }
    });
    finalDecision = planChangeDecisionSchema.parse(reviewed);

    if (finalDecision.decision === "needs_user_review") {
      state.status = "failed";
      state.phase = "FAILED";
      setStateError(state, "Config", "Plan change review returned needs_user_review; expected approved or denied.");
      return { ok: false, replans: args.replans };
    }
  }

  state.planHistory?.push({ type: "change_decision", decision: finalDecision });

  if (finalDecision.decision === "denied") {
    state.status = "failed";
    state.phase = "FAILED";
    setStateError(state, "Config", `Plan change denied by user review: ${finalDecision.reason}. Guidance: ${finalDecision.guidance}`);
    return { ok: false, replans: args.replans };
  }

  if (args.replans >= policy.budgets.max_replans) {
    state.status = "failed";
    state.phase = "FAILED";
    setStateError(state, "Config", `Replan budget exceeded: ${args.replans} >= ${policy.budgets.max_replans}`);
    return { ok: false, replans: args.replans };
  }

  state.planData = applyPlanChangePatch(currentPlan, changeProposal.changeRequest);
  state.planVersion = (state.planVersion ?? 1) + 1;
  return { ok: true, replans: args.replans + 1 };
};
