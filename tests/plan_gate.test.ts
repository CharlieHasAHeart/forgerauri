import { describe, expect, test } from "vitest";
import { evaluatePlanChange } from "../src/agent/plan/gate.js";
import { defaultAgentPolicy } from "../src/agent/policy/policy.js";
import { planChangeRequestV2Schema } from "../src/agent/plan/schema.js";

const baseRequest = () =>
  planChangeRequestV2Schema.parse({
    version: "v2",
    reason: "reorder for dependency",
    change_type: "tasks.reorder",
    impact: { steps_delta: 0, risk: "low" },
    evidence: [],
    requested_tools: [],
    patch: [{ action: "tasks.reorder", task_id: "t1", after_task_id: "t2" }]
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
    const gate = evaluatePlanChange({
      request: baseRequest(),
      policy: basePolicy(),
      currentTaskCount: 3
    });

    expect(gate.status).toBe("needs_user_review");
  });

  test("denies disallowed tools with guidance", () => {
    const request = planChangeRequestV2Schema.parse({
      ...baseRequest(),
      requested_tools: ["tool_not_allowed"]
    });

    const gate = evaluatePlanChange({
      request,
      policy: basePolicy(),
      currentTaskCount: 3
    });

    expect(gate.status).toBe("denied");
    expect((gate.guidance ?? "").length).toBeGreaterThan(0);
  });

  test("denies techStack.update when tech stack is locked", () => {
    const request = planChangeRequestV2Schema.parse({
      ...baseRequest(),
      change_type: "replace_tech",
      patch: [{ action: "techStack.update", changes: { locked: false } }]
    });

    const gate = evaluatePlanChange({
      request,
      policy: basePolicy(),
      currentTaskCount: 3
    });

    expect(gate.status).toBe("denied");
    expect((gate.guidance ?? "").length).toBeGreaterThan(0);
  });

  test("denies acceptance.update when acceptance is locked", () => {
    const request = planChangeRequestV2Schema.parse({
      ...baseRequest(),
      change_type: "relax_acceptance",
      patch: [{ action: "acceptance.update", changes: { locked: false } }]
    });

    const gate = evaluatePlanChange({
      request,
      policy: basePolicy(),
      currentTaskCount: 3
    });

    expect(gate.status).toBe("denied");
    expect((gate.guidance ?? "").length).toBeGreaterThan(0);
  });
});
