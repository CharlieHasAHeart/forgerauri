import { z } from "zod";
import { OpenAIAdapter } from "../adapters/openai.js";
import type { AgentRequestIR } from "../adapters/ir.js";
import { zodToResponseJsonSchema } from "../responses/schema.js";
import { BaseLlmProvider, type LlmCallOptions, type LlmMessage, type LlmResponse } from "../provider.js";

const defaultModel = (): string => process.env.OPENAI_MODEL || "gpt-4.1-mini";
const baseUrl = (): string => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

class OpenAIRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIRefusalError";
  }
}

const toMetadata = (value: LlmCallOptions["metadata"]): AgentRequestIR["metadata"] => {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const toTruncation = (value: LlmCallOptions["truncation"]): AgentRequestIR["truncation"] =>
  value === "auto" || value === "disabled" ? (value as "auto" | "disabled") : undefined;

const toIR = (messages: LlmMessage[], opts?: LlmCallOptions): AgentRequestIR => ({
  messages,
  instructions: opts?.instructions,
  previousResponseId: opts?.previousResponseId,
  model: opts?.model || defaultModel(),
  temperature: opts?.temperature,
  topP: opts?.topP,
  maxOutputTokens: opts?.maxOutputTokens,
  store: opts?.store,
  truncation: toTruncation(opts?.truncation),
  include: opts?.include,
  metadata: toMetadata(opts?.metadata),
  promptCacheKey: opts?.promptCacheKey,
  safetyIdentifier: opts?.safetyIdentifier,
  contextManagement: opts?.contextManagement,
  textFormat: opts?.textFormat,
  enableThinking: opts?.enableThinking
});

export class OpenAIResponsesProvider extends BaseLlmProvider {
  name = "openai_responses";
  private readonly adapter = new OpenAIAdapter();

  private async request(body: Record<string, unknown>): Promise<unknown> {
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
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI Responses API error ${response.status}: ${text}`);
    }

    return (await response.json()) as unknown;
  }

  async complete(messages: LlmMessage[], opts?: LlmCallOptions): Promise<LlmResponse> {
    const ir = toIR(messages, opts);
    const body = this.adapter.toRequestBody(ir);
    const raw = await this.request(body);
    const parsed = this.adapter.fromRawResponse(raw);

    return {
      text: parsed.text,
      responseId: parsed.responseId,
      output: parsed.output,
      raw: parsed.raw,
      usage: parsed.usage
    };
  }

  override async completeJSON<T>(
    messages: LlmMessage[],
    schema: z.ZodType<T>,
    opts?: LlmCallOptions
  ): Promise<{ data: T; raw: string; attempts: number; responseId?: string }> {
    if (!this.adapter.caps.supportsTextFormatJsonSchema) {
      return super.completeJSON(messages, schema, opts);
    }

    try {
      const format = zodToResponseJsonSchema(schema, "llm_response");
      const ir = toIR(messages, {
        ...opts,
        textFormat: format
      });
      const raw = await this.request(this.adapter.toRequestBody(ir));
      const parsed = this.adapter.fromRawResponse(raw);

      if ((parsed.refusals?.length ?? 0) > 0) {
        throw new OpenAIRefusalError(`Model refused to produce JSON: ${parsed.refusals?.join(" | ")}`);
      }

      const decoded = JSON.parse(parsed.text) as unknown;
      const data = schema.parse(decoded);
      return { data, raw: parsed.text, attempts: 1, responseId: parsed.responseId };
    } catch (error) {
      if (error instanceof OpenAIRefusalError) {
        throw error;
      }
      return super.completeJSON(messages, schema, opts);
    }
  }
}
