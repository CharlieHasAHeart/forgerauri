import { describe, expect, test } from "vitest";
import { proposePlan } from "../src/agent/planning/planner.js";
import { defaultAgentPolicy } from "../src/agent/policy/policy.js";
import { createToolRegistry } from "../src/agent/tools/registry.js";
import { MockProvider } from "./helpers/mockProvider.js";

describe("brain plan json", () => {
  test("parses fenced JSON with extra text", async () => {
    const registry = await createToolRegistry();
    const provider = new MockProvider([
      [
        "Here is your plan",
        "```json",
        JSON.stringify({
          version: "v1",
          goal: "demo",
          acceptance_locked: true,
          tech_stack_locked: true,
          milestones: [{ id: "m1", title: "start", task_ids: ["t1"] }],
          tasks: [
            {
              id: "t1",
              title: "Bootstrap",
              description: "Create base",
              dependencies: [],
              success_criteria: [{ type: "file_exists", path: "README.md" }]
            }
          ]
        }),
        "```"
      ].join("\n")
    ]);

    const result = await proposePlan({
      goal: "demo",
      provider,
      registry,
      stateSummary: {},
      policy: defaultAgentPolicy({
        maxSteps: 8,
        maxActionsPerTask: 4,
        maxRetriesPerTask: 2,
        maxReplans: 2,
        allowedTools: Object.keys(registry)
      }),
      maxToolCallsPerTurn: 4
    });

    expect(result.plan.tasks[0]?.id).toBe("t1");
  });

  test("retries once when first output invalid", async () => {
    const registry = await createToolRegistry();
    const provider = new MockProvider([
      "not json",
      JSON.stringify({
        version: "v1",
        goal: "demo",
        acceptance_locked: true,
        tech_stack_locked: true,
        milestones: [],
        tasks: [
          {
            id: "t1",
            title: "Bootstrap",
            description: "Create base",
            dependencies: [],
            success_criteria: [{ type: "file_exists", path: "README.md" }]
          }
        ]
      })
    ]);

    const result = await proposePlan({
      goal: "demo",
      provider,
      registry,
      stateSummary: {},
      policy: defaultAgentPolicy({
        maxSteps: 8,
        maxActionsPerTask: 4,
        maxRetriesPerTask: 2,
        maxReplans: 2,
        allowedTools: Object.keys(registry)
      }),
      maxToolCallsPerTurn: 4
    });

    expect(result.plan.version).toBe("v1");
  });
});
