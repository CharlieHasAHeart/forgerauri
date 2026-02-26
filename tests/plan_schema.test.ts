import { describe, expect, test } from "vitest";
import { planV1Schema } from "../src/agent/plan/schema.js";

describe("plan schema", () => {
  test("accepts valid plan", () => {
    const plan = planV1Schema.parse({
      version: "v1",
      goal: "build app",
      acceptance_locked: true,
      tech_stack_locked: true,
      milestones: [{ id: "m1", title: "bootstrap", task_ids: ["t1"] }],
      tasks: [
        {
          id: "t1",
          title: "bootstrap",
          description: "create project",
          dependencies: [],
          success_criteria: [{ type: "file_exists", path: "README.md" }]
        }
      ]
    });

    expect(plan.tasks).toHaveLength(1);
  });

  test("rejects dependency on unknown task", () => {
    const result = planV1Schema.safeParse({
      version: "v1",
      goal: "invalid",
      milestones: [],
      tasks: [
        {
          id: "t1",
          title: "x",
          description: "x",
          dependencies: ["missing"],
          success_criteria: [{ type: "file_exists", path: "README.md" }]
        }
      ]
    });

    expect(result.success).toBe(false);
  });
});
