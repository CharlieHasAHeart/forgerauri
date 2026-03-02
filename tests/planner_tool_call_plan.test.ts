import { describe, expect, test } from "vitest";
import { BaseLlmProvider, type LlmCallOptions, type LlmMessage, type LlmResponse } from "../src/llm/provider.js";
import { proposePlan } from "../src/agent/planning/planner.js";
import { defaultAgentPolicy } from "../src/agent/policy/policy.js";
import { createToolRegistry } from "../src/agent/tools/registry.js";

class DashScopePlanToolCallProvider extends BaseLlmProvider {
  name = "dashscope_responses";
  calls = 0;

  async complete(_messages: LlmMessage[], _opts?: LlmCallOptions): Promise<LlmResponse> {
    return { text: "", raw: {} };
  }

  async completeToolCalls(
    _messages: LlmMessage[],
    _tools: Array<{ name: string; description: string; inputJsonSchema: unknown }>,
    opts?: LlmCallOptions
  ): Promise<{
    toolCalls: Array<{ name: string; input: unknown }>;
    text?: string;
    raw?: string;
    responseId?: string;
    usage?: unknown;
    previousResponseIdSent?: string;
  }> {
    this.calls += 1;
    return {
      toolCalls: [
        {
          name: "emit_plan_v1",
          input: {
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
                success_criteria: [
                  { type: "file_exists", path: "README.md" },
                  { type: "file_contains", path: "design/contract.json", contains: "\"version\"" }
                ]
              }
            ]
          }
        }
      ],
      responseId: `resp-${this.calls}`,
      previousResponseIdSent: opts?.previousResponseId
    };
  }
}

class DashScopeInvalidPlanToolCallProvider extends BaseLlmProvider {
  name = "dashscope_responses";
  calls = 0;

  async complete(_messages: LlmMessage[], _opts?: LlmCallOptions): Promise<LlmResponse> {
    return { text: "", raw: {} };
  }

  async completeToolCalls(
    _messages: LlmMessage[],
    _tools: Array<{ name: string; description: string; inputJsonSchema: unknown }>,
    opts?: LlmCallOptions
  ): Promise<{
    toolCalls: Array<{ name: string; input: unknown }>;
    text?: string;
    raw?: string;
    responseId?: string;
    usage?: unknown;
    previousResponseIdSent?: string;
  }> {
    this.calls += 1;
    return {
      toolCalls: [
        {
          name: "emit_plan_v1",
          input: {
            version: "v1",
            goal: "demo",
            acceptance_locked: true,
            tech_stack_locked: true,
            milestones: [],
            tasks: [
              {
                id: 1,
                description: "bad",
                dependencies: [],
                success_criteria: { type: "file_exists", path: "README.md" }
              }
            ]
          }
        }
      ],
      responseId: `resp-invalid-${this.calls}`,
      previousResponseIdSent: opts?.previousResponseId
    };
  }
}

class DashScopeWrongToolThenCorrectProvider extends BaseLlmProvider {
  name = "dashscope_responses";
  calls = 0;

  async complete(_messages: LlmMessage[], _opts?: LlmCallOptions): Promise<LlmResponse> {
    return { text: "", raw: {} };
  }

  async completeToolCalls(
    _messages: LlmMessage[],
    _tools: Array<{ name: string; description: string; inputJsonSchema: unknown }>,
    opts?: LlmCallOptions
  ): Promise<{
    toolCalls: Array<{ name: string; input: unknown }>;
    text?: string;
    raw?: string;
    responseId?: string;
    usage?: unknown;
    previousResponseIdSent?: string;
  }> {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        toolCalls: [{ name: "tool_read_files", input: {} }],
        responseId: "resp-wrong",
        previousResponseIdSent: opts?.previousResponseId
      };
    }

    return {
      toolCalls: [
        {
          name: "emit_plan_v1",
          input: {
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
          }
        }
      ],
      responseId: "resp-correct",
      previousResponseIdSent: opts?.previousResponseId
    };
  }
}

describe("planner dashscope tool-calling path", () => {
  test("proposePlan parses emit_plan_v1 tool arguments", async () => {
    const registry = await createToolRegistry();
    const provider = new DashScopePlanToolCallProvider();

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

    expect(provider.calls).toBe(1);
    expect(result.plan.tasks[0]?.id).toBe("t1");
    expect(result.plan.tasks[0]?.success_criteria[1]).toEqual({
      type: "file_contains",
      path: "forgetauri.contract.json",
      contains: "\"version\""
    });
  });

  test("proposePlan retries and fails after invalid tool-call plan output", async () => {
    const registry = await createToolRegistry();
    const provider = new DashScopeInvalidPlanToolCallProvider();

    await expect(
      proposePlan({
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
      })
    ).rejects.toThrow();

    expect(provider.calls).toBe(3);
  });

  test("proposePlan retries when wrong tool is returned", async () => {
    const registry = await createToolRegistry();
    const provider = new DashScopeWrongToolThenCorrectProvider();

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

    expect(provider.calls).toBe(2);
    expect(result.plan.tasks[0]?.id).toBe("t1");
  });
});
