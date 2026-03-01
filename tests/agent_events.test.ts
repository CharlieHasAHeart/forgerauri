import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { describe, expect, test } from "vitest";
import { runAgent } from "../src/agent/index.js";
import type { ToolSpec } from "../src/agent/tools/types.js";
import type { AgentEvent } from "../src/agent/runtime/events.js";
import { MockProvider } from "./helpers/mockProvider.js";

describe("agent runtime events", () => {
  test("emits core routeA-compatible events during a successful run", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-events-"));
    const outDir = join(root, "generated");
    const events: AgentEvent[] = [];

    const provider = new MockProvider([
      JSON.stringify({
        version: "v1",
        goal: "event test",
        acceptance_locked: true,
        tech_stack_locked: true,
        milestones: [],
        tasks: [
          {
            id: "t1",
            title: "noop",
            description: "noop",
            dependencies: [],
            task_type: "build",
            success_criteria: [{ type: "tool_result", tool_name: "tool_noop", expected_ok: true }]
          }
        ]
      }),
      JSON.stringify({
        version: "v1",
        task_id: "t1",
        rationale: "run noop",
        actions: [{ name: "tool_noop", input: {} }]
      })
    ]);

    const registry: Record<string, ToolSpec<any>> = {
      tool_noop: {
        name: "tool_noop",
        description: "noop",
        inputSchema: z.object({}).passthrough(),
        inputJsonSchema: {},
        category: "low",
        capabilities: [],
        safety: { sideEffects: "none" },
        docs: "",
        run: async () => ({ ok: true, data: {}, meta: { touchedPaths: [] } }),
        examples: []
      }
    };

    const result = await runAgent({
      goal: "event test",
      specPath: join(root, "spec.json"),
      outDir,
      apply: true,
      verify: false,
      repair: false,
      provider,
      registry,
      maxTurns: 4,
      maxToolCallsPerTurn: 2,
      onEvent: (event) => {
        events.push(event);
      }
    });

    expect(result.ok).toBe(true);
    const names = events.map((event) => event.type);
    expect(names).toContain("plan_proposed");
    expect(names).toContain("turn_start");
    expect(names).toContain("task_selected");
    expect(names).toContain("tool_start");
    expect(names).toContain("tool_end");
    expect(names).toContain("criteria_result");
    expect(names).toContain("done");
  });
});

