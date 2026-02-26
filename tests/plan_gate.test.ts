import { describe, expect, test } from "vitest";
import { evaluatePlanChange } from "../src/agent/plan/gate.js";
import { defaultAgentPolicy } from "../src/agent/policy.js";
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
    allowedTools: ["tool_bootstrap_project"]
  });

describe("plan gate", () => {
  test("approves reorder_tasks", () => {
    const decision = evaluatePlanChange({
      request: baseRequest(),
      policy: basePolicy(),
      currentTaskCount: 3,
    });

    expect(decision.decision).toBe("approved");
  });

  test("denies relax_acceptance by default", () => {
    const request = planChangeRequestV2Schema.parse({
      ...baseRequest(),
      change_type: "relax_acceptance",
      reason: "skip tests",
      patch: [{ op: "edit_acceptance", changes: { locked: false } }]
    });

    const decision = evaluatePlanChange({
      request,
      policy: basePolicy(),
      currentTaskCount: 3,
    });

    expect(decision.decision).toBe("denied");
  });

  test("needs evidence for replace_tech without enough proof", () => {
    const request = planChangeRequestV2Schema.parse({
      ...baseRequest(),
      change_type: "replace_tech",
      reason: "switch stack",
      evidence: ["one failure"],
      impact: { steps_delta: 2, risk: "unknown" },
      patch: []
    });

    const decision = evaluatePlanChange({
      request,
      policy: basePolicy(),
      currentTaskCount: 3,
    });

    expect(decision.decision).toBe("needs_more_evidence");
  });
});
