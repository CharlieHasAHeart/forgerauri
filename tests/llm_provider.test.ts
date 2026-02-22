import { z } from "zod";
import { describe, expect, test } from "vitest";
import { MockProvider } from "../src/llm/providers/mock.js";

describe("llm provider completeJSON", () => {
  test("retries on invalid json then succeeds", async () => {
    const provider = new MockProvider(["not a json", "```json\n{\"ok\":true,\"value\":42}\n```"]);
    const schema = z.object({ ok: z.boolean(), value: z.number() });

    const result = await provider.completeJSON([{ role: "user", content: "return json" }], schema);

    expect(result.attempts).toBe(2);
    expect(result.data).toEqual({ ok: true, value: 42 });
  });
});
