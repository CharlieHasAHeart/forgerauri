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
import { userDecisionSchema, type GateResult, type PlanChangeRequestV2, type UserDecision } from "../plan/schema.js";

export type PlanChangeReviewContext = {
  request: PlanChangeRequestV2;
  gateResult: GateResult;
  policySummary?: unknown;
};

export type PlanChangeReviewFn = (ctx: PlanChangeReviewContext) => Promise<UserDecision>;

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

  const gateResult = evaluatePlanChange({
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
    gateResult
  });

  state.planHistory?.push({ type: "change_gate_result", gateResult });

  if (gateResult.status === "denied") {
    state.status = "failed";
    state.phase = "FAILED";
    setStateError(
      state,
      "Config",
      `Plan change denied: ${gateResult.reason}. Guidance: ${gateResult.guidance}`
    );
    return { ok: false, replans: args.replans };
  }

  const reviewed = await args.requestPlanChangeReview({
    request: changeProposal.changeRequest,
    gateResult,
    policySummary: {
      acceptanceLocked: policy.acceptance.locked,
      techStackLocked: policy.tech_stack_locked,
      allowedTools: policy.safety.allowed_tools
    }
  });
  const finalDecision = userDecisionSchema.parse(reviewed);
  state.planHistory?.push({ type: "change_user_decision", userDecision: finalDecision });

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
