import { describe, expect, test } from "vitest";
import { evaluatePlanChange } from "../src/agent/plan/gate.js";
import { defaultAgentPolicy } from "../src/agent/policy/policy.js";
import { planChangeRequestV2Schema } from "../src/agent/plan/schema.js";

const baseRequest = () =>
  planChangeRequestV2Schema.parse({
    version: "v2",
    reason: "reorder for dependency",
    change_type: "reorder_tasks",
    impact: { steps_delta: 0, risk: "low" },
    evidence: [],
    requested_tools: [],
    patch: [{ op: "reorder", task_id: "t1", after_task_id: "t2" }]
  });

const basePolicy = () =>
  defaultAgentPolicy({
    maxSteps: 10,
    maxActionsPerTask: 4,
    maxRetriesPerTask: 2,
    maxReplans: 2,
    allowedTools: ["tool_bootstrap_project", "tool_verify_project", "tool_repair_once"]
  });

describe("plan gate", () => {
  test("returns needs_user_review for normal change requests", () => {
    const decision = evaluatePlanChange({
      request: baseRequest(),
      policy: basePolicy(),
      currentTaskCount: 3
    });

    expect(decision.decision).toBe("needs_user_review");
  });

  test("denies disallowed tools with guidance", () => {
    const request = planChangeRequestV2Schema.parse({
      ...baseRequest(),
      requested_tools: ["tool_not_allowed"]
    });

    const decision = evaluatePlanChange({
      request,
      policy: basePolicy(),
      currentTaskCount: 3
    });

    expect(decision.decision).toBe("denied");
    expect((decision.guidance ?? "").length).toBeGreaterThan(0);
  });

  test("denies edit_tech_stack when tech stack is locked", () => {
    const request = planChangeRequestV2Schema.parse({
      ...baseRequest(),
      change_type: "replace_tech",
      patch: [{ op: "edit_tech_stack", changes: { locked: false } }]
    });

    const decision = evaluatePlanChange({
      request,
      policy: basePolicy(),
      currentTaskCount: 3
    });

    expect(decision.decision).toBe("denied");
    expect((decision.guidance ?? "").length).toBeGreaterThan(0);
  });

  test("denies edit_acceptance when acceptance is locked", () => {
    const request = planChangeRequestV2Schema.parse({
      ...baseRequest(),
      change_type: "relax_acceptance",
      patch: [{ op: "edit_acceptance", changes: { locked: false } }]
    });

    const decision = evaluatePlanChange({
      request,
      policy: basePolicy(),
      currentTaskCount: 3
    });

    expect(decision.decision).toBe("denied");
    expect((decision.guidance ?? "").length).toBeGreaterThan(0);
  });
});
