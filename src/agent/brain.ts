import { z } from "zod";
import type { LlmProvider } from "../llm/provider.js";
import type { ToolSpec } from "./tools/types.js";

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

const toolCatalog = (registry: Record<string, ToolSpec>): string =>
  Object.values(registry)
    .map((tool) => `- ${tool.name}: ${tool.description}\n  inputSchema: ${JSON.stringify(tool.inputJsonSchema ?? { type: "object" })}`)
    .join("\n");

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
        "You are the Brain of a coding agent. You must call tools, never fabricate results. " +
        "Hard guardrails: user-zone files can never be overwritten directly; only patch files are allowed. " +
        "Prefer high-level tools first: tool_bootstrap_project then tool_verify_project. " +
        "Only use tool_repair_once when verify fails and budget remains. " +
        "Return JSON only: {\"toolCalls\":[{\"name\":\"...\",\"input\":{}}],\"note\":\"optional\"}."
    },
    {
      role: "user" as const,
      content:
        `Goal:\n${args.goal}\n\n` +
        `Available tools:\n${toolCatalog(args.registry)}\n\n` +
        `Current state summary:\n${JSON.stringify(args.stateSummary, null, 2)}\n\n` +
        `Constraints:\n- maxToolCallsPerTurn=${args.maxToolCallsPerTurn}\n- Use tool_bootstrap_project for BOOT phase\n- Use tool_verify_project for VERIFY phase`
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
