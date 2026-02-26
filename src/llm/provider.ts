import { z } from "zod";

export type LlmMessage = { role: "system" | "developer" | "user" | "assistant"; content: string };

export type LlmCallOptions = {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  instructions?: string;
  previousResponseId?: string;
  store?: boolean;
  truncation?: "auto" | "disabled" | (string & {});
  include?: string[];
  metadata?: Record<string, unknown>;
  promptCacheKey?: string;
  safetyIdentifier?: string;
  contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
  textFormat?:
    | { type: "json_schema"; name: string; schema: unknown; strict?: boolean; description?: string }
    | { type: "json_object" }
    | { type: "text" };
};

export type LlmResponse = {
  text: string;
  responseId?: string;
  output?: unknown[];
  raw: unknown;
  usage?: unknown;
};

export interface LlmProvider {
  name: string;
  complete(messages: LlmMessage[], opts?: LlmCallOptions): Promise<LlmResponse>;
  completeText(messages: LlmMessage[], opts?: LlmCallOptions): Promise<string>;
  completeJSON<T>(
    messages: LlmMessage[],
    schema: z.ZodType<T>,
    opts?: LlmCallOptions
  ): Promise<{ data: T; raw: string; attempts: number }>;
}

const extractJsonObject = (raw: string): string => {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1].trim() : trimmed;

  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return source.slice(firstBrace, lastBrace + 1);
  }

  const firstBracket = source.indexOf("[");
  const lastBracket = source.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return source.slice(firstBracket, lastBracket + 1);
  }

  return source;
};

const summarizeZodError = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");

export abstract class BaseLlmProvider implements LlmProvider {
  abstract name: string;
  abstract complete(messages: LlmMessage[], opts?: LlmCallOptions): Promise<LlmResponse>;

  async completeText(messages: LlmMessage[], opts?: LlmCallOptions): Promise<string> {
    const response = await this.complete(messages, opts);
    return response.text;
  }

  async completeJSON<T>(
    messages: LlmMessage[],
    schema: z.ZodType<T>,
    opts?: LlmCallOptions
  ): Promise<{ data: T; raw: string; attempts: number }> {
    const maxAttempts = 3;
    let currentMessages = [...messages];
    let lastRaw = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      lastRaw = await this.completeText(currentMessages, opts);

      try {
        const jsonText = extractJsonObject(lastRaw);
        const parsed = JSON.parse(jsonText) as unknown;
        const data = schema.parse(parsed);
        return { data, raw: lastRaw, attempts: attempt };
      } catch (error) {
        if (attempt === maxAttempts) {
          if (error instanceof z.ZodError) {
            throw new Error(`LLM JSON validation failed after ${attempt} attempts: ${summarizeZodError(error)}`);
          }
          if (error instanceof Error) {
            throw new Error(`LLM JSON parse failed after ${attempt} attempts: ${error.message}`);
          }
          throw new Error(`LLM JSON parse failed after ${attempt} attempts`);
        }

        const summary =
          error instanceof z.ZodError
            ? summarizeZodError(error)
            : error instanceof Error
              ? error.message
              : "unknown parse error";

        currentMessages = [
          ...currentMessages,
          {
            role: "user",
            content:
              "Your previous response was not valid JSON for the required schema. " +
              `Errors: ${summary}. Return ONLY valid JSON.`
          }
        ];
      }
    }

    throw new Error("Unreachable");
  }
}
