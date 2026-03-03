import { z } from "zod";
import type { LlmProvider } from "../../llm/provider.js";
import type { AgentPolicy } from "../runtime/policy/policy.js";
import type { PlanV1 } from "../plan/schema.js";
import { llmJson } from "./json_extract.js";
import { renderToolIndex } from "./tool_index.js";
import type { ToolSpec } from "../tools/types.js";

const toolCallSchema = z.object({
  name: z.string().min(1),
  input: z.unknown()
});

const normalizeCalls = (
  calls: Array<{ name: string; input: unknown }>,
  registry: Record<string, ToolSpec<any>>
): Array<{ name: string; input: unknown }> => {
  const allowed = new Set(Object.keys(registry));
  return calls
    .filter((call) => allowed.has(call.name))
    .map((call) => ({ name: call.name, input: call.input }));
};

export const proposeToolCallsForTask = async (args: {
  goal: string;
  provider: LlmProvider;
  policy: AgentPolicy;
  task: PlanV1["tasks"][number];
  planSummary: unknown;
  stateSummary: unknown;
  registry: Record<string, ToolSpec<any>>;
  recentFailures: string[];
  maxToolCallsPerTurn: number;
  previousResponseId?: string;
  truncation?: "auto" | "disabled";
  contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
}): Promise<{
  toolCalls: Array<{ name: string; input: unknown }>;
  raw: string;
  responseId?: string;
  usage?: unknown;
  previousResponseIdSent?: string;
  mode: "native_tool_calling" | "json_fallback";
}> => {
  const taskRegistry = args.registry;

  const toolEntries = Object.entries(taskRegistry)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, tool]) => ({
      name,
      description: tool.description,
      inputJsonSchema: tool.inputJsonSchema
    }));

  const messages = [
    {
      role: "user" as const,
      content:
        `Goal:\n${args.goal}\n\n` +
        `Policy:\n${JSON.stringify(args.policy, null, 2)}\n\n` +
        `Task:\n${JSON.stringify(args.task, null, 2)}\n\n` +
        `Plan summary:\n${JSON.stringify(args.planSummary, null, 2)}\n\n` +
        `State summary:\n${JSON.stringify(args.stateSummary, null, 2)}\n\n` +
        `Recent failures:\n${JSON.stringify(args.recentFailures, null, 2)}\n\n` +
        `Authoritative runtime context (must be reused exactly):\n${JSON.stringify(
          {
            specPath: (args.stateSummary as Record<string, unknown>)?.specPath,
            outDir: (args.stateSummary as Record<string, unknown>)?.outDir,
            appDir: (args.stateSummary as Record<string, unknown>)?.appDir
          },
          null,
          2
        )}\n\n` +
        `Tool index:\n${renderToolIndex(taskRegistry)}\n\n` +
        `Constraints:\n- No per-task limit on tool call count.\n- Only use tool names from the provided tool list.\n` +
        "- For path-like fields (specPath/outDir/projectRoot), use the authoritative runtime context values exactly.\n"
    }
  ];

  if (typeof args.provider.completeToolCalls === "function") {
    try {
      const previousResponseIdSent =
        args.provider.name === "dashscope_responses" ? undefined : args.previousResponseId;
      const result = await args.provider.completeToolCalls(messages, toolEntries, {
        temperature: 0,
        maxOutputTokens: 3200,
        enableThinking: false,
        instructions:
          "You are task execution planner. Produce the tool calls needed to complete the current task efficiently, " +
          "and prefer returning multiple tool calls in one response when that improves task completion. " +
          "Do not modify global plan.",
        previousResponseId: previousResponseIdSent,
        truncation: args.truncation,
        contextManagement: args.contextManagement
      });
      const toolCalls = normalizeCalls(result.toolCalls ?? [], taskRegistry);
      return {
        toolCalls,
        raw: result.raw ?? result.text ?? JSON.stringify(toolCalls, null, 2),
        responseId: result.responseId,
        usage: result.usage,
        previousResponseIdSent: result.previousResponseIdSent ?? previousResponseIdSent,
        mode: "native_tool_calling"
      };
    } catch {
      // Fall through to JSON fallback path.
    }
  }

  const fallbackSchema = z.object({
    toolCalls: z.array(toolCallSchema)
  });

  const result = await llmJson({
    provider: args.provider,
    schema: fallbackSchema,
    instructions:
      "You are task execution planner. Return STRICT JSON only with shape {\"toolCalls\":[...]} " +
      "for the current task. Prefer including all necessary tool calls in one response when possible. " +
      "Use only known tool names.",
    previousResponseId: args.previousResponseId,
    truncation: args.truncation,
    contextManagement: args.contextManagement,
    maxOutputTokens: 3200,
    messages
  });

  return {
    toolCalls: normalizeCalls(result.data.toolCalls, taskRegistry),
    raw: result.raw,
    responseId: result.responseId,
    usage: result.usage,
    previousResponseIdSent: result.previousResponseIdSent,
    mode: "json_fallback"
  };
};
