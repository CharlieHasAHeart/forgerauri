import { describe, expect, test } from "vitest";
import { z } from "zod";
import { BaseLlmProvider, type LlmCallOptions, type LlmMessage, type LlmResponse } from "../src/llm/provider.js";
import { proposeToolCallsForTask } from "../src/agent/planning/tool_call_planner.js";
import { defaultAgentPolicy } from "../src/agent/policy/policy.js";
import type { ToolSpec } from "../src/agent/tools/types.js";

const task = {
  id: "t1",
  title: "task",
  description: "task",
  dependencies: [],
  tool_hints: [],
  success_criteria: [{ type: "tool_result" as const, tool_name: "tool_noop", expected_ok: true }],
  task_type: "build" as const
};

const registry: Record<string, ToolSpec<any>> = {
  tool_noop: {
    name: "tool_noop",
    description: "noop",
    inputSchema: z.object({}).passthrough(),
    inputJsonSchema: { type: "object" },
    category: "low",
    capabilities: [],
    safety: { sideEffects: "none" },
    docs: "",
    run: async () => ({ ok: true, data: {}, meta: { touchedPaths: [] } }),
    examples: []
  }
};

const policy = defaultAgentPolicy({
  maxSteps: 8,
  maxActionsPerTask: 2,
  maxRetriesPerTask: 2,
  maxReplans: 2,
  allowedTools: ["tool_noop"]
});

class NativeToolCallProvider extends BaseLlmProvider {
  name = "native";
  nativeCalls = 0;
  completeCalls = 0;

  async complete(_messages: LlmMessage[], _opts?: LlmCallOptions): Promise<LlmResponse> {
    this.completeCalls += 1;
    return { text: "{}", raw: {} };
  }

  async completeToolCalls(
    _messages: LlmMessage[],
    _tools: Array<{ name: string; description: string; inputJsonSchema: unknown }>,
    _opts?: LlmCallOptions
  ): Promise<{
    toolCalls: Array<{ name: string; input: unknown }>;
    text?: string;
    raw?: string;
    responseId?: string;
    usage?: unknown;
    previousResponseIdSent?: string;
  }> {
    this.nativeCalls += 1;
    return {
      toolCalls: [{ name: "tool_noop", input: {} }],
      text: "native",
      responseId: "resp-native"
    };
  }
}

class ThrowingToolCallProvider extends BaseLlmProvider {
  name = "throwing";
  nativeCalls = 0;
  completeCalls = 0;

  async complete(_messages: LlmMessage[], _opts?: LlmCallOptions): Promise<LlmResponse> {
    this.completeCalls += 1;
    return { text: "{\"toolCalls\":[{\"name\":\"tool_noop\",\"input\":{}}]}", raw: {} };
  }

  async completeToolCalls(
    _messages: LlmMessage[],
    _tools: Array<{ name: string; description: string; inputJsonSchema: unknown }>,
    _opts?: LlmCallOptions
  ): Promise<{
    toolCalls: Array<{ name: string; input: unknown }>;
    text?: string;
    raw?: string;
    responseId?: string;
    usage?: unknown;
    previousResponseIdSent?: string;
  }> {
    this.nativeCalls += 1;
    throw new Error("native unsupported");
  }
}

describe("tool_call_planner", () => {
  test("uses native tool calling when provider supports it", async () => {
    const provider = new NativeToolCallProvider();
    const out = await proposeToolCallsForTask({
      goal: "goal",
      provider,
      policy,
      task,
      planSummary: {},
      stateSummary: {},
      registry,
      recentFailures: [],
      maxToolCallsPerTurn: 2
    });

    expect(out.mode).toBe("native_tool_calling");
    expect(out.toolCalls).toEqual([{ name: "tool_noop", input: {} }]);
    expect(provider.nativeCalls).toBe(1);
    expect(provider.completeCalls).toBe(0);
  });

  test("falls back to json mode when native tool calling fails", async () => {
    const provider = new ThrowingToolCallProvider();
    const out = await proposeToolCallsForTask({
      goal: "goal",
      provider,
      policy,
      task,
      planSummary: {},
      stateSummary: {},
      registry,
      recentFailures: [],
      maxToolCallsPerTurn: 2
    });

    expect(out.mode).toBe("json_fallback");
    expect(out.toolCalls[0]?.name).toBe("tool_noop");
    expect(provider.nativeCalls).toBe(1);
    expect(provider.completeCalls).toBe(1);
  });

  test("clips tool calls to maxToolCallsPerTurn", async () => {
    const provider = new NativeToolCallProvider();
    provider.completeToolCalls = async () => ({
      toolCalls: [
        { name: "tool_noop", input: {} },
        { name: "tool_noop", input: {} },
        { name: "tool_noop", input: {} }
      ],
      text: "native",
      responseId: "resp-native-2"
    });

    const out = await proposeToolCallsForTask({
      goal: "goal",
      provider,
      policy,
      task,
      planSummary: {},
      stateSummary: {},
      registry,
      recentFailures: [],
      maxToolCallsPerTurn: 1
    });

    expect(out.toolCalls).toHaveLength(1);
  });
});
