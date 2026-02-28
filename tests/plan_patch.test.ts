import { describe, expect, test } from "vitest";
import { applyPlanChangePatch } from "../src/agent/plan/patch.js";
import { planChangeRequestV2Schema, type PlanV1 } from "../src/agent/plan/schema.js";

const basePlan: PlanV1 = {
  version: "v1",
  goal: "demo",
  acceptance_locked: true,
  tech_stack_locked: true,
  milestones: [],
  tasks: [
    {
      id: "t1",
      title: "one",
      description: "one",
      dependencies: [],
      tool_hints: [],
      success_criteria: [{ type: "file_exists", path: "a" }],
      task_type: "build"
    },
    {
      id: "t2",
      title: "two",
      description: "two",
      dependencies: ["t1"],
      tool_hints: [],
      success_criteria: [{ type: "file_exists", path: "b" }],
      task_type: "test"
    }
  ]
};

describe("plan patch apply", () => {
  test("add/edit/reorder/remove task", () => {
    const add = planChangeRequestV2Schema.parse({
      version: "v2",
      reason: "add debug",
      change_type: "tasks.add",
      evidence: [],
      impact: { steps_delta: 1, risk: "low" },
      requested_tools: [],
      patch: [
        {
          action: "tasks.add",
          after_task_id: "t1",
          task: {
            id: "t3",
            title: "three",
            description: "three",
            dependencies: ["t1"],
            success_criteria: [{ type: "file_exists", path: "c" }]
          }
        }
      ]
    });

    const p1 = applyPlanChangePatch(basePlan, add);
    expect(p1.tasks.map((t) => t.id)).toEqual(["t1", "t3", "t2"]);

    const edit = planChangeRequestV2Schema.parse({
      version: "v2",
      reason: "edit",
      change_type: "tasks.update",
      evidence: [],
      impact: { steps_delta: 0, risk: "low" },
      requested_tools: [],
      patch: [{ action: "tasks.update", task_id: "t3", changes: { title: "three-updated" } }]
    });

    const p2 = applyPlanChangePatch(p1, edit);
    expect(p2.tasks.find((t) => t.id === "t3")?.title).toBe("three-updated");

    const reorder = planChangeRequestV2Schema.parse({
      version: "v2",
      reason: "tasks.reorder",
      change_type: "tasks.reorder",
      evidence: [],
      impact: { steps_delta: 0, risk: "low" },
      requested_tools: [],
      patch: [{ action: "tasks.reorder", task_id: "t2" }]
    });

    const p3 = applyPlanChangePatch(p2, reorder);
    expect(p3.tasks[0]?.id).toBe("t2");

    const remove = planChangeRequestV2Schema.parse({
      version: "v2",
      reason: "remove",
      change_type: "tasks.remove",
      evidence: [],
      impact: { steps_delta: -1, risk: "low" },
      requested_tools: [],
      patch: [{ action: "tasks.remove", task_id: "t3" }]
    });

    const p4 = applyPlanChangePatch(p3, remove);
    expect(p4.tasks.some((t) => t.id === "t3")).toBe(false);
  });

  test("throws on invalid patched plan", () => {
    const bad = planChangeRequestV2Schema.parse({
      version: "v2",
      reason: "break deps",
      change_type: "tasks.remove",
      evidence: [],
      impact: { steps_delta: -1, risk: "low" },
      requested_tools: [],
      patch: [{ action: "tasks.remove", task_id: "t1" }]
    });

    expect(() => applyPlanChangePatch(basePlan, bad)).toThrow(/invalid PlanV1/);
  });
});
