import { BaseLlmProvider, type LlmCallOptions, type LlmMessage } from "../provider.js";

const defaultModel = (): string => process.env.DASHSCOPE_MODEL || "qwen3-max-2026-01-23";
const baseUrl = (): string =>
  (process.env.DASHSCOPE_BASE_URL ||
    "https://dashscope-intl.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1").replace(/\/$/, "");

const toPrompt = (messages: LlmMessage[]): string =>
  messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join("\n\n");

const extractOutputText = (response: unknown): string => {
  const res = response as Record<string, unknown>;

  const direct = res.output_text;
  if (typeof direct === "string") return direct;

  const output = res.output;
  if (Array.isArray(output)) {
    const chunks: string[] = [];
    for (const item of output) {
      const itemObj = item as Record<string, unknown>;
      const content = itemObj.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        const cObj = c as Record<string, unknown>;
        const text = cObj.text;
        if (typeof text === "string") chunks.push(text);
      }
    }
    if (chunks.length > 0) return chunks.join("\n");
  }

  return JSON.stringify(response);
};

export class DashScopeResponsesProvider extends BaseLlmProvider {
  name = "dashscope_responses";

  async completeText(messages: LlmMessage[], opts?: LlmCallOptions): Promise<string> {
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

    const json = (await response.json()) as unknown;
    return extractOutputText(json);
  }
}
