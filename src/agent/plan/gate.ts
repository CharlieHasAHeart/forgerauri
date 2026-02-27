import type { AgentPolicy } from "../policy/policy.js";
import type { GateResult, PlanChangeRequestV2 } from "./schema.js";

export type PlanChangeGateInput = {
  request: PlanChangeRequestV2;
  policy: AgentPolicy;
  currentTaskCount: number;
};

const needsUserReview = (reason: string): GateResult => ({
  status: "needs_user_review",
  reason
});

const denied = (reason: string, guidance: string): GateResult => ({
  status: "denied",
  reason,
  guidance,
  suggested_patch: []
});

const hasDisallowedTools = (requestedTools: string[], allowedToolNames: string[]): boolean => {
  const allow = new Set(allowedToolNames);
  return requestedTools.some((tool) => !allow.has(tool));
};

const patchTouchesAcceptanceOrTech = (request: PlanChangeRequestV2): { acceptance: boolean; tech: boolean } => ({
  acceptance: request.patch.some((op) => op.op === "edit_acceptance"),
  tech: request.patch.some((op) => op.op === "edit_tech_stack")
});

export const evaluatePlanChange = (input: PlanChangeGateInput): GateResult => {
  const { request, policy } = input;

  if (hasDisallowedTools(request.requested_tools, policy.safety.allowed_tools)) {
    return denied(
      "request uses disallowed tools",
      `Remove disallowed tools and use only: ${policy.safety.allowed_tools.join(", ")}`
    );
  }

  const touches = patchTouchesAcceptanceOrTech(request);

  if (request.change_type === "relax_acceptance" && !policy.userExplicitlyAllowedRelaxAcceptance) {
    return denied(
      "relax_acceptance is blocked unless user explicitly allows it",
      "Do not relax acceptance. Add debug/repair tasks or edit existing tasks to satisfy current acceptance criteria."
    );
  }

  if (policy.acceptance.locked && touches.acceptance && !policy.userExplicitlyAllowedRelaxAcceptance) {
    return denied(
      "acceptance is locked by policy",
      "Keep acceptance unchanged. Propose task-level fixes (add_task/edit_task) instead of editing acceptance."
    );
  }

  if (policy.tech_stack_locked && touches.tech) {
    return denied(
      "tech stack is locked by policy",
      "Do not edit tech stack. Keep current stack and propose debug/test/build-fix tasks to resolve failures."
    );
  }

  return needsUserReview("user review required for any plan change");
};
