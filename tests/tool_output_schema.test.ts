import { describe, expect, test } from "vitest";
import { createToolRegistry } from "../src/agent/tools/registry.js";
import { MockProvider } from "./helpers/mockProvider.js";

describe("tool output schema validation", () => {
  test("fails when override returns invalid output payload", async () => {
    const registry = await createToolRegistry({
      runDesignContractImpl: async () =>
        ({
          contract: {
            version: "v1"
          },
          attempts: 1,
          raw: "{}"
        }) as any
    });

    const tool = registry.tool_design_contract;
    expect(tool).toBeTruthy();

    const result = await tool.run(
      {
        goal: "design",
        specPath: "/tmp/spec.json",
        rawSpec: { app: { name: "Demo" } }
      },
      {
        provider: new MockProvider([]),
        runCmdImpl: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }),
        flags: {
          apply: true,
          verify: true,
          repair: true,
          maxPatchesPerTurn: 8,
          verifyLevel: "basic"
        },
        memory: {
          patchPaths: [],
          touchedPaths: []
        }
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TOOL_OUTPUT_SCHEMA_INVALID");
  });
});
