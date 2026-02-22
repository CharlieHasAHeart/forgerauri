import { describe, expect, test } from "vitest";
import { proposeNextActions } from "../src/agent/brain.js";
import { createToolRegistry } from "../src/agent/tools/registry.js";
import { MockProvider } from "../src/llm/providers/mock.js";

describe("brain schema validation", () => {
  test("retries once when tool name is invalid", async () => {
    const provider = new MockProvider([
      JSON.stringify({ toolCalls: [{ name: "tool_not_exists", input: {} }] }),
      JSON.stringify({ toolCalls: [{ name: "tool_load_spec", input: { specPath: "/tmp/spec.json" } }] })
    ]);

    const out = await proposeNextActions({
      goal: "load spec",
      provider,
      registry: createToolRegistry(),
      stateSummary: { turn: 1 },
      maxToolCallsPerTurn: 4
    });

    expect(out.toolCalls[0]?.name).toBe("tool_load_spec");
  });

  test("retries once when input schema is invalid", async () => {
    const provider = new MockProvider([
      JSON.stringify({ toolCalls: [{ name: "tool_load_spec", input: { specPath: 123 } }] }),
      JSON.stringify({ toolCalls: [{ name: "tool_load_spec", input: { specPath: "/tmp/spec.json" } }] })
    ]);

    const out = await proposeNextActions({
      goal: "load spec",
      provider,
      registry: createToolRegistry(),
      stateSummary: { turn: 1 },
      maxToolCallsPerTurn: 4
    });

    expect(out.toolCalls[0]?.name).toBe("tool_load_spec");
  });
});
