import { describe, expect, test } from "vitest";
import { proposeNextActions } from "../src/agent/brain.js";
import { createToolRegistry } from "../src/agent/tools/registry.js";
import { MockProvider } from "../src/llm/providers/mock.js";

describe("brain schema validation", () => {
  test("retries once when tool name is invalid", async () => {
    const provider = new MockProvider([
      JSON.stringify({ toolCalls: [{ name: "tool_not_exists", input: {} }] }),
      JSON.stringify({ toolCalls: [{ name: "tool_bootstrap_project", input: { specPath: "/tmp/spec.json", outDir: "/tmp/out", apply: true, llmEnrich: false } }] })
    ]);

    const out = await proposeNextActions({
      goal: "bootstrap",
      provider,
      registry: createToolRegistry(),
      stateSummary: { phase: "BOOT" },
      maxToolCallsPerTurn: 4
    });

    expect(out.toolCalls[0]?.name).toBe("tool_bootstrap_project");
  });

  test("retries once when input schema is invalid", async () => {
    const provider = new MockProvider([
      JSON.stringify({ toolCalls: [{ name: "tool_verify_project", input: { projectRoot: 123 } }] }),
      JSON.stringify({ toolCalls: [{ name: "tool_verify_project", input: { projectRoot: "/tmp/out/app" } }] })
    ]);

    const out = await proposeNextActions({
      goal: "verify",
      provider,
      registry: createToolRegistry(),
      stateSummary: { phase: "VERIFY" },
      maxToolCallsPerTurn: 4
    });

    expect(out.toolCalls[0]?.name).toBe("tool_verify_project");
  });
});
