import { parseResponsesOutput } from "../responses/parse.js";
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

export class OpenAIResponsesProvider extends BaseLlmProvider {
  name = "openai_responses";

  async complete(messages: LlmMessage[], opts?: LlmCallOptions): Promise<LlmResponse> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error("OPENAI_API_KEY is required for OpenAI Responses provider");
    }

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
    if (opts?.textFormat !== undefined) {
      body.text = { format: opts.textFormat };
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

    const raw = (await response.json()) as unknown;
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
}
