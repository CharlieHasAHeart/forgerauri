import { z } from "zod";
import { parseResponsesOutput } from "../responses/parse.js";
import { zodToResponseJsonSchema } from "../responses/schema.js";
import { BaseLlmProvider, type LlmCallOptions, type LlmMessage, type LlmResponse } from "../provider.js";

const defaultModel = (): string => process.env.OPENAI_MODEL || "gpt-4.1-mini";
const baseUrl = (): string => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

type ResponseInputItem = {
  type: "message";
  role: "system" | "developer" | "user" | "assistant";
  content: Array<{ type: "input_text"; text: string }>;
};

const toInputItems = (messages: LlmMessage[]): ResponseInputItem[] =>
  messages.map((message) => ({
    type: "message",
    role: message.role,
    content: [{ type: "input_text", text: message.content }]
  }));

const buildRequestBody = (messages: LlmMessage[], opts?: LlmCallOptions): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    model: opts?.model || defaultModel(),
    input: toInputItems(messages)
  };

  if (typeof opts?.temperature === "number") body.temperature = opts.temperature;
  if (typeof opts?.maxOutputTokens === "number") body.max_output_tokens = opts.maxOutputTokens;
  if (typeof opts?.instructions === "string") body.instructions = opts.instructions;
  if (typeof opts?.previousResponseId === "string") body.previous_response_id = opts.previousResponseId;
  if (typeof opts?.store === "boolean") body.store = opts.store;
  if (typeof opts?.truncation === "string") body.truncation = opts.truncation;
  if (Array.isArray(opts?.include)) body.include = opts.include;
  if (opts?.metadata && typeof opts.metadata === "object") body.metadata = opts.metadata;
  if (typeof opts?.promptCacheKey === "string") body.prompt_cache_key = opts.promptCacheKey;
  if (typeof opts?.safetyIdentifier === "string") body.safety_identifier = opts.safetyIdentifier;
  if (Array.isArray(opts?.contextManagement)) {
    body.context_management = opts.contextManagement.map((item) => ({
      type: item.type,
      compact_threshold: item.compactThreshold
    }));
  }
  if (opts?.textFormat !== undefined) {
    body.text = { format: opts.textFormat };
  }

  return body;
};

class OpenAIRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIRefusalError";
  }
}

export class OpenAIResponsesProvider extends BaseLlmProvider {
  name = "openai_responses";

  private async request(messages: LlmMessage[], opts?: LlmCallOptions): Promise<unknown> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error("OPENAI_API_KEY is required for OpenAI Responses provider");
    }

    const response = await fetch(`${baseUrl()}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildRequestBody(messages, opts))
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI Responses API error ${response.status}: ${text}`);
    }

    return (await response.json()) as unknown;
  }

  async complete(messages: LlmMessage[], opts?: LlmCallOptions): Promise<LlmResponse> {
    const raw = await this.request(messages, opts);
    const parsed = parseResponsesOutput(raw);
    const rawObj = raw as Record<string, unknown>;
    const outputTextFallback = typeof rawObj.output_text === "string" ? rawObj.output_text : "";

    return {
      text: parsed.text || outputTextFallback || JSON.stringify(raw),
      responseId: typeof rawObj.id === "string" ? rawObj.id : undefined,
      output: parsed.output,
      usage: rawObj.usage,
      raw
    };
  }

  override async completeJSON<T>(
    messages: LlmMessage[],
    schema: z.ZodType<T>,
    opts?: LlmCallOptions
  ): Promise<{ data: T; raw: string; attempts: number }> {
    const format = zodToResponseJsonSchema(schema, "llm_response");

    try {
      const response = await this.complete(messages, {
        ...opts,
        textFormat: format
      });

      const parsed = parseResponsesOutput(response.raw);
      if (parsed.refusals.length > 0) {
        throw new OpenAIRefusalError(`Model refused to produce JSON: ${parsed.refusals.join(" | ")}`);
      }

      const jsonText = parsed.text || response.text;
      const decoded = JSON.parse(jsonText) as unknown;
      const data = schema.parse(decoded);
      return {
        data,
        raw: jsonText,
        attempts: 1
      };
    } catch (error) {
      if (error instanceof OpenAIRefusalError) {
        throw error;
      }
      return super.completeJSON(messages, schema, opts);
    }
  }
}
