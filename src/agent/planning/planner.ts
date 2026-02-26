import { z } from "zod";
import type { LlmProvider } from "../../llm/provider.js";
import type { AgentPolicy } from "../policy/policy.js";
import type { PlanChangeRequestV2, PlanV1, TaskActionPlanV1 } from "../plan/schema.js";
import { planChangeRequestV2Schema, planV1Schema, taskActionPlanV1Schema } from "../plan/schema.js";
import { llmJsonWithRetry, extractJsonObject } from "./json_extract.js";
import { DEFAULT_BRAIN_INSTRUCTIONS, DEFAULT_PLAN_CHANGE_INSTRUCTIONS, DEFAULT_PLAN_INSTRUCTIONS, DEFAULT_TASK_ACTION_INSTRUCTIONS } from "./prompts.js";
import { renderToolIndex } from "./tool_index.js";
import type { ToolDocPack, ToolSpec } from "../tools/types.js";

type Proposed = {
  toolCalls: Array<{ name: string; input: unknown }>;
  note?: string;
};

const renderToolDocs = (toolDocs: ToolDocPack[]): string =>
  toolDocs
    .map((tool) => {
      const examples = tool.examples
        .slice(0, 2)
        .map((item) => `- ${item.title}: ${JSON.stringify(item.toolCall)}`)
        .join("\n");
      return [
        `Tool: ${tool.name}`,
        `Category: ${tool.category}`,
        `Summary: ${tool.summary}`,
        `InputSchema: ${JSON.stringify(tool.inputJsonSchema)}`,
        tool.outputJsonSchema ? `OutputSchema: ${JSON.stringify(tool.outputJsonSchema)}` : "OutputSchema: <none>",
        `Safety: ${JSON.stringify(tool.safety)}`,
        examples ? `Examples:\n${examples}` : "Examples: <none>",
        `Docs:\n${tool.docs || "<none>"}`
      ].join("\n");
    })
    .join("\n\n---\n\n");

const validateToolCalls = (
  value: Proposed,
  registry: Record<string, ToolSpec>,
  maxToolCallsPerTurn: number
): { ok: true; data: Proposed } | { ok: false; message: string } => {
  if (value.toolCalls.length > maxToolCallsPerTurn) {
    return { ok: false, message: `toolCalls exceeds maxToolCallsPerTurn=${maxToolCallsPerTurn}` };
  }

  for (const call of value.toolCalls) {
    const tool = registry[call.name];
    if (!tool) {
      return { ok: false, message: `Unknown tool: ${call.name}` };
    }

    const parsed = tool.inputSchema.safeParse(call.input);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
      return { ok: false, message: `Invalid input for ${call.name}: ${details}` };
    }
  }

  return { ok: true, data: value };
};

export const proposePlan = async (args: {
  goal: string;
  provider: LlmProvider;
  registry: Record<string, ToolSpec>;
  stateSummary: unknown;
  policy: AgentPolicy;
  maxToolCallsPerTurn: number;
  previousResponseId?: string;
  instructions?: string;
  truncation?: "auto" | "disabled";
  contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
}): Promise<{
  plan: PlanV1;
  raw: string;
  responseId?: string;
  usage?: unknown;
  previousResponseIdSent?: string;
}> => {
  const instructions = args.instructions ?? DEFAULT_PLAN_INSTRUCTIONS;

  const toolIndex = renderToolIndex(args.registry);

  const result = await llmJsonWithRetry({
    provider: args.provider,
    schema: planV1Schema,
    instructions,
    previousResponseId: args.previousResponseId,
    truncation: args.truncation,
    contextManagement: args.contextManagement,
    maxOutputTokens: 4500,
    messages: [
      {
        role: "user",
        content:
          `Create PlanV1 for this goal:\n${args.goal}\n\n` +
          `Tech stack constraints (locked unless user allows):\n${JSON.stringify(
            args.policy,
            null,
            2
          )}\n\n` +
          `Tool index:\n${toolIndex}\n\n` +
          `Repo state summary:\n${JSON.stringify(args.stateSummary, null, 2)}\n\n` +
          `Planning constraints:\n${JSON.stringify(
            {
              maxSteps: args.policy.budgets.max_steps,
              maxToolCallsPerTurn: args.maxToolCallsPerTurn,
              acceptanceLocked: args.policy.acceptance.locked,
              techStackLocked: args.policy.tech_stack_locked
            },
            null,
            2
          )}\n` +
          "Every task must include success_criteria with machine-checkable command/file checks."
      }
    ]
  });

  return {
    plan: result.data,
    raw: result.raw,
    responseId: result.responseId,
    usage: result.usage,
    previousResponseIdSent: result.previousResponseIdSent
  };
};

export const proposePlanChange = async (args: {
  provider: LlmProvider;
  goal: string;
  currentPlan: PlanV1;
  policy: AgentPolicy;
  stateSummary: unknown;
  failureEvidence: string[];
  previousResponseId?: string;
  instructions?: string;
  truncation?: "auto" | "disabled";
  contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
}): Promise<{
  changeRequest: PlanChangeRequestV2;
  raw: string;
  responseId?: string;
  usage?: unknown;
  previousResponseIdSent?: string;
}> => {
  const instructions = args.instructions ?? DEFAULT_PLAN_CHANGE_INSTRUCTIONS;

  const result = await llmJsonWithRetry({
    provider: args.provider,
    schema: planChangeRequestV2Schema,
    instructions,
    previousResponseId: args.previousResponseId,
    truncation: args.truncation,
    contextManagement: args.contextManagement,
    messages: [
      {
        role: "user",
        content:
          `Goal:\n${args.goal}\n\n` +
          `Current plan:\n${JSON.stringify(args.currentPlan, null, 2)}\n\n` +
          `Policy:\n${JSON.stringify(args.policy, null, 2)}\n\n` +
          `Failure evidence:\n${JSON.stringify(args.failureEvidence, null, 2)}\n\n` +
          `State summary:\n${JSON.stringify(args.stateSummary, null, 2)}\n` +
          "Return PlanChangeRequestV2 JSON only."
      }
    ]
  });

  return {
    changeRequest: result.data,
    raw: result.raw,
    responseId: result.responseId,
    usage: result.usage,
    previousResponseIdSent: result.previousResponseIdSent
  };
};

export const proposeTaskActionPlan = async (args: {
  goal: string;
  provider: LlmProvider;
  policy: AgentPolicy;
  task: PlanV1["tasks"][number];
  planSummary: unknown;
  stateSummary: unknown;
  toolIndex: string;
  recentFailures: string[];
  previousResponseId?: string;
  instructions?: string;
  truncation?: "auto" | "disabled";
  contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
}): Promise<{
  actionPlan: TaskActionPlanV1;
  raw: string;
  responseId?: string;
  usage?: unknown;
  previousResponseIdSent?: string;
}> => {
  const instructions = args.instructions ?? DEFAULT_TASK_ACTION_INSTRUCTIONS;

  const result = await llmJsonWithRetry({
    provider: args.provider,
    schema: taskActionPlanV1Schema,
    instructions,
    previousResponseId: args.previousResponseId,
    truncation: args.truncation,
    contextManagement: args.contextManagement,
    maxOutputTokens: 3200,
    messages: [
      {
        role: "user",
        content:
          `Goal:\n${args.goal}\n\n` +
          `Policy:\n${JSON.stringify(args.policy, null, 2)}\n\n` +
          `Task:\n${JSON.stringify(args.task, null, 2)}\n\n` +
          `Plan summary:\n${JSON.stringify(args.planSummary, null, 2)}\n\n` +
          `State summary:\n${JSON.stringify(args.stateSummary, null, 2)}\n\n` +
          `Recent failures:\n${JSON.stringify(args.recentFailures, null, 2)}\n\n` +
          `Tool index:\n${args.toolIndex}\n` +
          "Return TaskActionPlanV1 JSON only. Keep actions idempotent where possible."
      }
    ]
  });

  return {
    actionPlan: result.data,
    raw: result.raw,
    responseId: result.responseId,
    usage: result.usage,
    previousResponseIdSent: result.previousResponseIdSent
  };
};

export const proposeNextActions = async (args: {
  goal: string;
  provider: LlmProvider;
  registry: Record<string, ToolSpec>;
  toolDocs: ToolDocPack[];
  stateSummary: unknown;
  maxToolCallsPerTurn: number;
  previousResponseId?: string;
  instructions?: string;
  truncation?: "auto" | "disabled";
  contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
}): Promise<{
  toolCalls: Array<{ name: string; input: unknown }>;
  reasoning?: string;
  raw: string;
  responseId?: string;
  usage?: unknown;
  previousResponseIdSent?: string;
}> => {
  const instructions = args.instructions ?? DEFAULT_BRAIN_INSTRUCTIONS;
  const proposedSchema = z.object({
    toolCalls: z.array(z.object({ name: z.string().min(1), input: z.unknown() })).max(args.maxToolCallsPerTurn),
    note: z.string().optional()
  });

  const baseMessages = [
    {
      role: "user" as const,
      content:
        `Goal:\n${args.goal}\n\n` +
        `Tool docs:\n${renderToolDocs(args.toolDocs)}\n\n` +
        `Current state summary:\n${JSON.stringify(args.stateSummary, null, 2)}\n\n` +
        `Constraints:\n- maxToolCallsPerTurn=${args.maxToolCallsPerTurn}\n- Return tool calls for the current step only.`
    }
  ];

  let messages = [...baseMessages];
  let raw = "";
  let responseId: string | undefined;
  let usage: unknown;
  let previousResponseIdForAttempt = args.previousResponseId;
  let previousResponseIdSent: string | undefined;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    previousResponseIdSent = previousResponseIdForAttempt;
    const llmResponse = await args.provider.complete(messages, {
      temperature: 0,
      maxOutputTokens: 3000,
      instructions,
      previousResponseId: previousResponseIdForAttempt,
      truncation: args.truncation,
      contextManagement: args.contextManagement
    });
    raw = llmResponse.text;
    responseId = llmResponse.responseId;
    usage = llmResponse.usage;
    previousResponseIdForAttempt = llmResponse.responseId ?? previousResponseIdForAttempt;

    try {
      const parsed = proposedSchema.parse(JSON.parse(extractJsonObject(raw)) as unknown);
      const validated = validateToolCalls(parsed, args.registry, args.maxToolCallsPerTurn);
      if (validated.ok) {
        return {
          toolCalls: validated.data.toolCalls,
          reasoning: validated.data.note,
          raw,
          responseId,
          usage,
          previousResponseIdSent
        };
      }

      if (attempt === 2) throw new Error(validated.message);
      messages = [...messages, { role: "user" as const, content: `Invalid tool calls: ${validated.message}. Return corrected JSON only.` }];
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid JSON";
      if (attempt === 2) throw new Error(`Brain output invalid after retry: ${message}`);
      messages = [...messages, { role: "user" as const, content: `Invalid response: ${message}. Return strict JSON only.` }];
    }
  }

  throw new Error("Brain output invalid");
};
