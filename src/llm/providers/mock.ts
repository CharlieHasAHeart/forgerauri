import { BaseLlmProvider, type LlmCallOptions, type LlmMessage } from "../provider.js";

export class MockProvider extends BaseLlmProvider {
  name = "mock";
  private readonly outputs: string[];

  constructor(outputs: string[]) {
    super();
    this.outputs = [...outputs];
  }

  async completeText(_messages: LlmMessage[], _opts?: LlmCallOptions): Promise<string> {
    if (this.outputs.length === 0) {
      throw new Error("MockProvider outputs exhausted");
    }
    return this.outputs.shift() as string;
  }
}
