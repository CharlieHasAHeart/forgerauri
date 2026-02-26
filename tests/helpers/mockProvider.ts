import { BaseLlmProvider, type LlmCallOptions, type LlmMessage, type LlmResponse } from "../../src/llm/provider.js";

export class MockProvider extends BaseLlmProvider {
  name = "mock";
  private readonly outputs: string[];

  constructor(outputs: string[]) {
    super();
    this.outputs = [...outputs];
  }

  async complete(_messages: LlmMessage[], _opts?: LlmCallOptions): Promise<LlmResponse> {
    if (this.outputs.length === 0) {
      throw new Error("MockProvider outputs exhausted");
    }
    const text = this.outputs.shift() as string;
    return {
      text,
      raw: { output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] },
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }]
    };
  }
}
