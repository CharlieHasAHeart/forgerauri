import type { PlanChangeDecision, PlanChangeRequestV1 } from "./schema.js";

export type PlanChangeGateInput = {
  request: PlanChangeRequestV1;
  maxSteps: number;
  currentTaskCount: number;
  allowedToolNames: string[];
  allowedCommandPrefixes?: string[];
  userExplicitlyAllowedRelaxAcceptance?: boolean;
};

const hasDisallowedTools = (requestedTools: string[], allowedToolNames: string[]): boolean => {
  const allow = new Set(allowedToolNames);
  return requestedTools.some((tool) => !allow.has(tool));
};

const hasDisallowedCommands = (request: PlanChangeRequestV1, allowedCommandPrefixes: string[] | undefined): boolean => {
  if (!allowedCommandPrefixes || !request.proposed_plan) return false;
  const allowed = new Set(allowedCommandPrefixes);

  for (const task of request.proposed_plan.tasks) {
    for (const criterion of task.success_criteria) {
      if (criterion.type !== "command") continue;
      if (!allowed.has(criterion.cmd)) return true;
    }
  }

  return false;
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

export const evaluatePlanChange = (input: PlanChangeGateInput): PlanChangeDecision => {
  const { request } = input;

  if (hasDisallowedTools(request.requested_tools, input.allowedToolNames)) {
    return denied("request uses disallowed tools");
  }

  if (hasDisallowedCommands(request, input.allowedCommandPrefixes)) {
    return denied("request introduces disallowed command checks");
  }

  if (request.change_type === "relax_acceptance" && !input.userExplicitlyAllowedRelaxAcceptance) {
    return denied("relax_acceptance is blocked unless user explicitly allows it");
  }

  if (request.change_type === "reorder_tasks") {
    return approved("reorder_tasks allowed without scope change");
  }

  if (request.change_type === "scope_reduce") {
    return approved("scope_reduce is always allowed");
  }

  if (request.change_type === "add_task") {
    const stepsAfter = (request.proposed_plan?.tasks.length ?? input.currentTaskCount) + Math.max(0, request.impact.steps_delta);
    const withinBudget = stepsAfter <= input.maxSteps;
    const lowRisk = ["debug", "test", "build", "repair", "verify", "fix"].some((token) => request.reason.toLowerCase().includes(token));

    if (withinBudget && lowRisk) {
      return approved("add_task approved for debug/test/build-fix within budget");
    }

    return needsEvidence("add_task requires evidence or exceeds budget", ["failure log", "estimated added steps"]);
  }

  if (request.change_type === "scope_expand") {
    if (request.evidence.length > 0 && request.impact.risk.trim().length > 0) {
      return needsEvidence("scope_expand requires explicit approval after evidence review", ["impact estimate", "user approval"]);
    }
    return needsEvidence("scope_expand requires evidence and impact estimate", ["evidence", "impact estimate"]);
  }

  if (request.change_type === "replace_tech") {
    const hasTwoEvidences = request.evidence.length >= 2;
    const hasMigrationImpact = /migrat|impact|compat|risk/i.test(request.impact.risk);
    if (hasTwoEvidences && hasMigrationImpact) {
      return needsEvidence("replace_tech requires human confirmation", ["two distinct failures", "migration impact"]);
    }
    return needsEvidence("replace_tech requires two failures and migration impact", ["two distinct failures", "migration impact"]);
  }

  return denied("unknown change type");
};
