import { describe, expect, test } from "vitest";
import { evaluatePlanChange } from "../src/agent/plan/gate.js";
import { planChangeRequestV1Schema } from "../src/agent/plan/schema.js";

const baseRequest = () =>
  planChangeRequestV1Schema.parse({
    version: "v1",
    reason: "reorder for dependency",
    change_type: "reorder_tasks",
    impact: { steps_delta: 0, risk: "low" },
    evidence: [],
    requested_tools: []
  });

describe("plan gate", () => {
  test("approves reorder_tasks", () => {
    const decision = evaluatePlanChange({
      request: baseRequest(),
      maxSteps: 10,
      currentTaskCount: 3,
      allowedToolNames: ["tool_bootstrap_project"]
    });

    expect(decision.decision).toBe("approved");
  });

  test("denies relax_acceptance by default", () => {
    const request = planChangeRequestV1Schema.parse({
      ...baseRequest(),
      change_type: "relax_acceptance",
      reason: "skip tests"
    });

    const decision = evaluatePlanChange({
      request,
      maxSteps: 10,
      currentTaskCount: 3,
      allowedToolNames: ["tool_bootstrap_project"]
    });

    expect(decision.decision).toBe("denied");
  });

  test("needs evidence for replace_tech without enough proof", () => {
    const request = planChangeRequestV1Schema.parse({
      ...baseRequest(),
      change_type: "replace_tech",
      reason: "switch stack",
      evidence: ["one failure"],
      impact: { steps_delta: 2, risk: "unknown" }
    });

    const decision = evaluatePlanChange({
      request,
      maxSteps: 10,
      currentTaskCount: 3,
      allowedToolNames: ["tool_bootstrap_project"]
    });

    expect(decision.decision).toBe("needs_more_evidence");
  });
});
