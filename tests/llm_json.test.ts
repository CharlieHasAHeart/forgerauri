import { describe, expect, test } from "vitest";
import { z } from "zod";
import { BaseLlmProvider, type LlmCallOptions, type LlmMessage, type LlmResponse } from "../src/llm/provider.js";
import { llmJson } from "../src/agent/planning/json_extract.js";

class StructuredProvider extends BaseLlmProvider {
  name = "structured";
  completeCalls = 0;
  completeJsonCalls = 0;

  async complete(_messages: LlmMessage[], _opts?: LlmCallOptions): Promise<LlmResponse> {
    this.completeCalls += 1;
    return { text: "{}", raw: {} };
  }

  override async completeJSON<T>(
    _messages: LlmMessage[],
    _schema: z.ZodType<T>,
    _opts?: LlmCallOptions
  ): Promise<{ data: T; raw: string; attempts: number; responseId?: string }> {
    this.completeJsonCalls += 1;
    return {
      data: { value: 1 } as T,
      raw: "",
      attempts: 1,
      responseId: "resp-structured"
    };
  }
}

class FallbackProvider extends BaseLlmProvider {
  name = "fallback";
  completeCalls = 0;
  completeJsonCalls = 0;

  async complete(_messages: LlmMessage[], _opts?: LlmCallOptions): Promise<LlmResponse> {
    this.completeCalls += 1;
    return {
      text: "```json\n{\"value\":2}\n```",
      raw: {}
    };
  }

  override async completeJSON<T>(
    _messages: LlmMessage[],
    _schema: z.ZodType<T>,
    _opts?: LlmCallOptions
  ): Promise<{ data: T; raw: string; attempts: number; responseId?: string }> {
    this.completeJsonCalls += 1;
    throw new Error("structured unavailable");
  }
}

describe("llmJson", () => {
  test("prefers provider.completeJSON when available", async () => {
    const provider = new StructuredProvider();
    const schema = z.object({ value: z.number() });
    const result = await llmJson({
      provider,
      messages: [{ role: "user", content: "return json" }],
      schema,
      instructions: "json only"
    });

    expect(provider.completeJsonCalls).toBe(1);
    expect(provider.completeCalls).toBe(0);
    expect(result.data.value).toBe(1);
    expect(result.raw.length).toBeGreaterThan(0);
    expect(result.responseId).toBe("resp-structured");
  });

  test("falls back to text extraction when completeJSON fails", async () => {
    const provider = new FallbackProvider();
    const schema = z.object({ value: z.number() });
    const result = await llmJson({
      provider,
      messages: [{ role: "user", content: "return json" }],
      schema,
      instructions: "json only"
    });

    expect(provider.completeJsonCalls).toBe(1);
    expect(provider.completeCalls).toBe(1);
    expect(result.data.value).toBe(2);
    expect(result.raw.length).toBeGreaterThan(0);
  });
});

