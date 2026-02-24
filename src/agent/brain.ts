import { z } from "zod";
import type { LlmProvider } from "../llm/provider.js";
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

export const proposeNextActions = async (args: {
  goal: string;
  provider: LlmProvider;
  registry: Record<string, ToolSpec>;
  toolDocs: ToolDocPack[];
  stateSummary: unknown;
  maxToolCallsPerTurn: number;
}): Promise<{ toolCalls: Array<{ name: string; input: unknown }>; reasoning?: string; raw: string }> => {
  const proposedSchema = z.object({
    toolCalls: z.array(z.object({ name: z.string().min(1), input: z.unknown() })).max(args.maxToolCallsPerTurn),
    note: z.string().optional()
  });

  const baseMessages = [
    {
      role: "system" as const,
      content:
        "You are the Brain of a coding agent. You must call tools and never fabricate results. " +
        "Hard guardrails: user-zone files cannot be overwritten directly, only patch artifacts are allowed. " +
        "Use tool documentation below to choose calls. Prefer high-level flow: bootstrap -> verify -> repair(if verify fails). " +
        "Return JSON only: {\"toolCalls\":[{\"name\":\"...\",\"input\":{}}],\"note\":\"optional\"}."
    },
    {
      role: "user" as const,
      content:
        `Goal:\n${args.goal}\n\n` +
        `Tool docs:\n${renderToolDocs(args.toolDocs)}\n\n` +
        `Current state summary:\n${JSON.stringify(args.stateSummary, null, 2)}\n\n` +
        `Constraints:\n- maxToolCallsPerTurn=${args.maxToolCallsPerTurn}\n- BOOT should use tool_bootstrap_project\n- VERIFY should use tool_verify_project\n- REPAIR should use tool_repair_once then verify`
    }
  ];

  let messages = [...baseMessages];
  let raw = "";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    raw = await args.provider.completeText(messages, {
      temperature: 0,
      maxOutputTokens: 3000
    });

    try {
      const parsed = proposedSchema.parse(JSON.parse(extractJsonObject(raw)) as unknown);
      const validated = validateToolCalls(parsed, args.registry, args.maxToolCallsPerTurn);
      if (validated.ok) {
        return {
          toolCalls: validated.data.toolCalls,
          reasoning: validated.data.note,
          raw
        };
      }

      if (attempt === 2) throw new Error(validated.message);
      messages = [
        ...messages,
        { role: "user" as const, content: `Invalid tool calls: ${validated.message}. Return corrected JSON only.` }
      ];
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid JSON";
      if (attempt === 2) throw new Error(`Brain output invalid after retry: ${message}`);
      messages = [...messages, { role: "user" as const, content: `Invalid response: ${message}. Return strict JSON only.` }];
    }
  }

  throw new Error("Brain output invalid");
};
