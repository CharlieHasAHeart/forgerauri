import { describe, expect, test } from "vitest";
import { toolPackage } from "../src/agent/tools/design_contract/index.js";
import { MockProvider } from "./helpers/mockProvider.js";

describe("tool_design_contract", () => {
  test("returns validated contract design from LLM JSON", async () => {
    const provider = new MockProvider([
      JSON.stringify({
        version: "v1",
        app: { name: "MacroGraph", description: "Macro workflow desktop app" },
        commands: [
          {
            name: "lint_config",
            purpose: "lint config file",
            inputs: [{ name: "file_path", type: "string" }],
            outputs: [{ name: "ok", type: "boolean" }],
            sideEffects: ["db_write"],
            idempotent: true
          }
        ],
        dataModel: {
          tables: [
            {
              name: "lint_runs",
              columns: [
                { name: "id", type: "integer", primaryKey: true },
                { name: "file_path", type: "text" }
              ]
            }
          ],
          migrations: { strategy: "single" }
        },
        acceptance: {
          mustPass: ["pnpm_build", "cargo_check"],
          smokeCommands: ["lint_config"]
        }
      })
    ]);

    const result = await toolPackage.runtime.run(
      {
        goal: "Design contracts",
        specPath: "/tmp/spec.json",
        rawSpec: { app: { name: "MacroGraph" } }
      },
      {
        provider,
        runCmdImpl: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }),
        flags: { apply: true, verify: true, repair: true, maxPatchesPerTurn: 8, verifyLevel: "basic" },
        memory: { patchPaths: [], touchedPaths: [] }
      }
    );

    expect(result.ok).toBe(true);
    const data = result.data as { contract: { version: string; commands: Array<{ name: string }> } };
    expect(data.contract.version).toBe("v1");
    expect(data.contract.commands[0]?.name).toBe("lint_config");
  });
});
