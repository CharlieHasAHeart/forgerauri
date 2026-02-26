import { parseResponsesOutput } from "../responses/parse.js";
import { BaseLlmProvider, type LlmCallOptions, type LlmMessage, type LlmResponse } from "../provider.js";

const defaultModel = (): string => process.env.DASHSCOPE_MODEL || "qwen3-max-2026-01-23";
const baseUrl = (): string =>
  (process.env.DASHSCOPE_BASE_URL ||
    "https://dashscope-intl.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1").replace(/\/$/, "");

const toPrompt = (messages: LlmMessage[]): string =>
  messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join("\n\n");

export class DashScopeResponsesProvider extends BaseLlmProvider {
  name = "dashscope_responses";

  async complete(messages: LlmMessage[], opts?: LlmCallOptions): Promise<LlmResponse> {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) {
      throw new Error("DASHSCOPE_API_KEY is required for DashScope Responses provider");
    }

    const body = {
      model: opts?.model || defaultModel(),
      input: toPrompt(messages),
      temperature: opts?.temperature ?? 0,
      max_output_tokens: opts?.maxOutputTokens ?? 4096
    };

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

    const raw = (await response.json()) as unknown;
    const parsed = parseResponsesOutput(raw);
    const rawObj = raw as Record<string, unknown>;
    const direct = typeof rawObj.output_text === "string" ? rawObj.output_text : "";

    return {
      text: parsed.text || direct || JSON.stringify(raw),
      responseId: typeof rawObj.id === "string" ? rawObj.id : undefined,
      output: parsed.output,
      usage: rawObj.usage,
      raw
    };
  }
}
