import { describe, expect, test } from "vitest";
import { MockProvider } from "../src/llm/providers/mock.js";
import { enrichWireSpecWithLLM } from "../src/spec/enrichWithLLM.js";
import { parseSpecFromRaw } from "../src/spec/loadSpec.js";

describe("spec enrich", () => {
  test("fills command io dictionary and keeps immutable names", async () => {
    const wire = {
      app: { name: "Agnix", one_liner: "x" },
      screens: [{ name: "Home", primary_actions: [] }],
      rust_commands: [{ name: "lint_config", input: {}, output: {} }],
      data_model: { tables: [] },
      acceptance_tests: [],
      mvp_plan: []
    };

    const provider = new MockProvider([
      JSON.stringify({
        commands: {
          lint_config: {
            input: { file_path: "string", strict: "boolean?" },
            output: { ok: "boolean", message: "string", diagnostics: "json" }
          }
        },
        screens: { Home: { purpose: "Main page" } },
        mvp_plan: ["step1"]
      })
    ]);

    const enriched = await enrichWireSpecWithLLM({ wire, provider });
    const parsed = parseSpecFromRaw(enriched.wireEnriched);

    expect(parsed.app.name).toBe("Agnix");
    expect(parsed.rust_commands[0].name).toBe("lint_config");
    expect(parsed.rust_commands[0].input).toMatchObject({ file_path: "string", strict: "boolean?" });
    expect(parsed.rust_commands[0].output).toMatchObject({ ok: "boolean", message: "string", diagnostics: "json" });
  });
});
