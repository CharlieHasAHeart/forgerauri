import { describe, expect, test } from "vitest";
import { proposeTaskActionPlan } from "../src/agent/planning/planner.js";
import { defaultAgentPolicy } from "../src/agent/policy/policy.js";
import { createToolRegistry } from "../src/agent/tools/registry.js";
import { MockProvider } from "./helpers/mockProvider.js";

describe("task action planner", () => {
  test("retries once on invalid json", async () => {
    const registry = await createToolRegistry();
    const provider = new MockProvider([
      "not-json",
      JSON.stringify({
        version: "v1",
        task_id: "t1",
        rationale: "run bootstrap",
        actions: [
          {
            name: "tool_bootstrap_project",
            input: {
              specPath: "/tmp/spec.json",
              outDir: "/tmp/out",
              apply: true
            }
          }
        ],
        expected_artifacts: ["/tmp/out/app"]
      })
    ]);

    const out = await proposeTaskActionPlan({
      goal: "do task",
      provider,
      policy: defaultAgentPolicy({
        maxSteps: 8,
        maxActionsPerTask: 4,
        maxRetriesPerTask: 2,
        maxReplans: 2,
        allowedTools: Object.keys(registry)
      }),
      task: {
        id: "t1",
        title: "Bootstrap",
        description: "Bootstrap project",
        dependencies: [],
        tool_hints: [],
        success_criteria: [{ type: "tool_result", tool_name: "tool_bootstrap_project", expected_ok: true }],
        task_type: "build"
      },
      planSummary: { tasks: 1 },
      stateSummary: { phase: "BOOT" },
      toolIndex: "[]",
      recentFailures: []
    });

    expect(out.actionPlan.task_id).toBe("t1");
    expect(out.actionPlan.actions[0]?.name).toBe("tool_bootstrap_project");
  });
});
