import { createHash } from "node:crypto";
import { z } from "zod";
import type { LlmProvider } from "../llm/provider.js";
import type { AgentPolicy } from "./policy.js";
import type { PlanChangeRequestV2, PlanV1, TaskActionPlanV1 } from "./plan/schema.js";
import { planChangeRequestV2Schema, planV1Schema, taskActionPlanV1Schema } from "./plan/schema.js";
import type { ToolDocPack, ToolSpec } from "./tools/types.js";

type Proposed = {
  toolCalls: Array<{ name: string; input: unknown }>;
  note?: string;
};

const extractJsonObject = (raw: string): string => {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1].trim() : trimmed;
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return source.slice(firstBrace, lastBrace + 1);
  return source;
};

const stableStringify = (value: unknown): string => {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      const obj = input as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(obj)
          .sort((a, b) => a.localeCompare(b))
          .map((key) => [key, normalize(obj[key])])
      );
    }
    return input;
  };

  return JSON.stringify(normalize(value));
};

const schemaFingerprint = (schema: unknown): string => {
  const digest = createHash("sha256").update(stableStringify(schema)).digest("hex");
  return `sha256:${digest.slice(0, 16)}`;
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

export const renderToolIndex = (registry: Record<string, ToolSpec>): string => {
  const rows = Object.values(registry)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tool) => ({
      name: tool.name,
      category: tool.category,
      summary: tool.description,
      safety: tool.safety,
      input_schema_fingerprint: schemaFingerprint(tool.inputJsonSchema)
    }));
  return JSON.stringify(rows, null, 2);
};

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

const llmJsonWithRetry = async <T>(args: {
  provider: LlmProvider;
  messages: Array<{ role: "user" | "assistant" | "system" | "developer"; content: string }>;
  schema: z.ZodType<T>;
  instructions: string;
  previousResponseId?: string;
  truncation?: "auto" | "disabled";
  contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
  maxOutputTokens?: number;
}): Promise<{
  data: T;
  raw: string;
  responseId?: string;
  usage?: unknown;
  previousResponseIdSent?: string;
}> => {
  let currentMessages = [...args.messages];
  let previousResponseIdForAttempt = args.previousResponseId;
  let raw = "";
  let responseId: string | undefined;
  let usage: unknown;
  let previousResponseIdSent: string | undefined;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    previousResponseIdSent = previousResponseIdForAttempt;
    const response = await args.provider.complete(currentMessages, {
      temperature: 0,
      maxOutputTokens: args.maxOutputTokens ?? 3000,
      instructions: args.instructions,
      previousResponseId: previousResponseIdForAttempt,
      truncation: args.truncation,
      contextManagement: args.contextManagement
    });
    raw = response.text;
    responseId = response.responseId;
    usage = response.usage;
    previousResponseIdForAttempt = response.responseId ?? previousResponseIdForAttempt;

    try {
      const data = args.schema.parse(JSON.parse(extractJsonObject(raw)) as unknown);
      return {
        data,
        raw,
        responseId,
        usage,
        previousResponseIdSent
      };
    } catch (error) {
      if (attempt === 2) {
        const message = error instanceof Error ? error.message : "invalid JSON";
        throw new Error(`LLM output invalid after retry: ${message}`);
      }
      const message = error instanceof Error ? error.message : "invalid JSON";
      currentMessages = [
        ...currentMessages,
        { role: "user", content: `Invalid JSON/schema: ${message}. Return STRICT JSON only, no markdown.` }
      ];
    }
  }

  throw new Error("unreachable");
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
  const instructions =
    args.instructions ??
    "You are a planning brain for a coding agent. Return strict JSON only. Build a machine-checkable plan with dependencies and success criteria.";

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
  const instructions =
    args.instructions ??
    "You are a planning brain. Propose a minimal plan change request in strict JSON. Keep acceptance and tech stack unless evidence demands otherwise.";

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
          "Return PlanChangeRequestV1 JSON only."
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
  const instructions =
    args.instructions ??
    "You are a task executor planner. Return strict JSON only. Propose minimal tool actions for one task.";

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
  const instructions =
    args.instructions ??
    "You are the Brain of a coding agent. You must call tools and never fabricate results. Return JSON only.";
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
