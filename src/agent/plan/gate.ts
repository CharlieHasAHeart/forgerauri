import type { AgentPolicy } from "../policy.js";
import type { PlanChangeDecision, PlanChangeRequestV2 } from "./schema.js";

export type PlanChangeGateInput = {
  request: PlanChangeRequestV2;
  policy: AgentPolicy;
  currentTaskCount: number;
};

const approved = (reason: string): PlanChangeDecision => ({
  decision: "approved",
  reason,
  required_evidence: []
});

const denied = (reason: string): PlanChangeDecision => ({
  decision: "denied",
  reason,
  required_evidence: []
});

const needsEvidence = (reason: string, requiredEvidence: string[]): PlanChangeDecision => ({
  decision: "needs_more_evidence",
  reason,
  required_evidence: requiredEvidence
});

const hasDisallowedTools = (requestedTools: string[], allowedToolNames: string[]): boolean => {
  const allow = new Set(allowedToolNames);
  return requestedTools.some((tool) => !allow.has(tool));
};

const patchTouchesAcceptanceOrTech = (request: PlanChangeRequestV2): { acceptance: boolean; tech: boolean } => ({
  acceptance: request.patch.some((op) => op.op === "edit_acceptance"),
  tech: request.patch.some((op) => op.op === "edit_tech_stack")
});

const containsDebugStyleScope = (request: PlanChangeRequestV2): boolean => {
  const lowerReason = request.reason.toLowerCase();
  const reasonHints = ["debug", "test", "build", "repair", "fix", "verify"];
  if (reasonHints.some((token) => lowerReason.includes(token))) return true;

  return request.patch.some(
    (op) => op.op === "add_task" && ["debug", "test", "build", "repair", "verify"].includes(op.task.task_type)
  );
};

const hasMigrationImpact = (risk: string): boolean => /migrat|impact|compat|risk/i.test(risk);

export const evaluatePlanChange = (input: PlanChangeGateInput): PlanChangeDecision => {
  const { request, policy } = input;

  if (hasDisallowedTools(request.requested_tools, policy.safety.allowed_tools)) {
    return denied("request uses disallowed tools");
  }

  const touches = patchTouchesAcceptanceOrTech(request);

  if (request.change_type === "relax_acceptance" && !policy.userExplicitlyAllowedRelaxAcceptance) {
    return denied("relax_acceptance is blocked unless user explicitly allows it");
  }

  if (policy.acceptance.locked && touches.acceptance && !policy.userExplicitlyAllowedRelaxAcceptance) {
    return denied("acceptance is locked by policy");
  }

  if (policy.tech_stack_locked && touches.tech) {
    return denied("tech stack is locked by policy");
  }

  if (request.change_type === "reorder_tasks") {
    if (!touches.acceptance && !touches.tech) {
      return approved("reorder_tasks allowed without acceptance/tech changes");
    }
    return denied("reorder_tasks cannot modify acceptance or tech stack");
  }

  if (request.change_type === "scope_reduce") {
    return approved("scope_reduce is always allowed");
  }

  if (request.change_type === "add_task") {
    const stepsAfter = input.currentTaskCount + Math.max(0, request.impact.steps_delta);
    const withinBudget = stepsAfter <= policy.budgets.max_steps;
    if (withinBudget && containsDebugStyleScope(request)) {
      return approved("add_task approved for debug/test/build-fix within budget");
    }
    return needsEvidence("add_task requires stronger evidence or exceeds budget", ["failure evidence", "step impact estimate"]);
  }

  if (request.change_type === "scope_expand") {
    return needsEvidence("scope_expand requires explicit approval", ["impact estimate", "approval note"]);
  }

  if (request.change_type === "replace_tech") {
    const hasTwoEvidences = request.evidence.length >= 2;
    if (!hasTwoEvidences || !hasMigrationImpact(request.impact.risk)) {
      return needsEvidence("replace_tech requires >=2 distinct evidence items and migration impact", ["two failures", "migration impact"]);
    }
    return needsEvidence("replace_tech still requires explicit approval", ["approval note"]);
  }

  if (request.change_type === "remove_task" || request.change_type === "edit_task") {
    return approved(`${request.change_type} approved by deterministic gate`);
  }

  return denied("unknown change type");
};
