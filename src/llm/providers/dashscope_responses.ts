import { DashScopeAdapter } from "../adapters/dashscope.js";
import type { AgentRequestIR } from "../adapters/ir.js";
import { BaseLlmProvider, type LlmCallOptions, type LlmMessage, type LlmResponse } from "../provider.js";

const defaultModel = (): string => process.env.DASHSCOPE_MODEL || "qwen3-max-2026-01-23";
const baseUrl = (): string =>
  (process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1").replace(/\/$/, "");

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

export class DashScopeResponsesProvider extends BaseLlmProvider {
  name = "dashscope_responses";
  private readonly adapter = new DashScopeAdapter();

  private async request(body: Record<string, unknown>): Promise<unknown> {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) {
      throw new Error("DASHSCOPE_API_KEY is required for DashScope Responses provider");
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
      throw new Error(`DashScope Responses API error ${response.status}: ${text}`);
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
}
