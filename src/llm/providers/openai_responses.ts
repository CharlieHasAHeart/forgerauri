import { BaseLlmProvider, type LlmCallOptions, type LlmMessage } from "../provider.js";

const defaultModel = (): string => process.env.OPENAI_MODEL || "gpt-4.1-mini";
const baseUrl = (): string => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

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

  const raw = JSON.stringify(response);
  return raw;
};

export class OpenAIResponsesProvider extends BaseLlmProvider {
  name = "openai_responses";

  async completeText(messages: LlmMessage[], opts?: LlmCallOptions): Promise<string> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error("OPENAI_API_KEY is required for OpenAI Responses provider");
    }

    const prompt = messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n");

    const body = {
      model: opts?.model || defaultModel(),
      input: prompt,
      temperature: opts?.temperature ?? 0,
      max_output_tokens: opts?.maxOutputTokens ?? 2048
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
      throw new Error(`OpenAI Responses API error ${response.status}: ${text}`);
    }

    const json = (await response.json()) as unknown;
    return extractOutputText(json);
  }
}
