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

export const handleReplan = async (args: {
  provider: LlmProvider;
  state: AgentState;
  policy: AgentPolicy;
  failedTaskId: string;
  failures: string[];
  replans: number;
  audit: AgentTurnAuditCollector;
  turn: number;
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

  state.planHistory?.push({ type: "change_decision", decision });

  recordPlanChange({
    audit: args.audit,
    turn: args.turn,
    llmRaw: changeProposal.raw,
    previousResponseIdSent: changeProposal.previousResponseIdSent,
    responseId: changeProposal.responseId,
    usage: changeProposal.usage,
    decision
  });

  if (decision.decision !== "approved") {
    state.status = "failed";
    state.phase = "FAILED";
    setStateError(
      state,
      "Config",
      `Plan change ${decision.decision}: ${decision.reason}${
        decision.required_evidence.length > 0 ? ` (required: ${decision.required_evidence.join(", ")})` : ""
      }`
    );
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
