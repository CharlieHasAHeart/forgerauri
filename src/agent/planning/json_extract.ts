import { z } from "zod";
import type { LlmProvider, LlmMessage } from "../../llm/provider.js";

export const extractJsonObject = (raw: string): string => {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1].trim() : trimmed;
  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return source.slice(firstBrace, lastBrace + 1);
  return source;
};

export const llmJsonWithRetry = async <T>(args: {
  provider: LlmProvider;
  messages: LlmMessage[];
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
