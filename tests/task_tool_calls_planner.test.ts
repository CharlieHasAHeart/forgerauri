import { describe, expect, test } from "vitest";
import { proposeToolCallsForTask } from "../src/agent/planning/tool_call_planner.js";
import { defaultAgentPolicy } from "../src/agent/policy/policy.js";
import { createToolRegistry } from "../src/agent/tools/registry.js";
import { MockProvider } from "./helpers/mockProvider.js";

describe("task tool-call planner", () => {
  test("retries once on invalid json", async () => {
    const registry = await createToolRegistry();
    const provider = new MockProvider([
      "not-json",
      JSON.stringify({
        toolCalls: [
          {
            name: "tool_bootstrap_project",
            input: {
              specPath: "/tmp/spec.json",
              outDir: "/tmp/out",
              apply: true
            }
          }
        ]
      })
    ]);

    const out = await proposeToolCallsForTask({
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
      stateSummary: { status: "executing" },
      registry,
      recentFailures: [],
      maxToolCallsPerTurn: 4
    });

    expect(out.mode).toBe("json_fallback");
    expect(out.toolCalls[0]?.name).toBe("tool_bootstrap_project");
  });
});
