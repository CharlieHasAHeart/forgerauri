import { describe, expect, test } from "vitest";
import { toolPackage } from "../src/agent/tools/core/design_implementation/index.js";
import { MockProvider } from "./helpers/mockProvider.js";
import type { ContractDesignV1 } from "../src/agent/design/contract/schema.js";

const contract: ContractDesignV1 = {
  version: "v1",
  app: { name: "MacroGraph" },
  commands: [
    {
      name: "lint_config",
      purpose: "lint",
      inputs: [{ name: "file_path", type: "string" }],
      outputs: [{ name: "ok", type: "boolean" }]
    }
  ],
  dataModel: { tables: [{ name: "lint_runs", columns: [{ name: "id", type: "integer", primaryKey: true }] }], migrations: { strategy: "single" } },
  acceptance: { mustPass: ["pnpm_build"] }
};

describe("tool_design_implementation", () => {
  test("returns validated implementation design", async () => {
    const provider = new MockProvider([
      JSON.stringify({
        version: "v1",
        rust: {
          layering: "commands_service_repo",
          services: [{ name: "lint_service", responsibilities: ["run lint"], usesTables: ["lint_runs"] }],
          repos: [{ name: "lint_repo", table: "lint_runs", operations: ["insert", "list"] }],
          errorModel: { pattern: "thiserror+ApiResponse", errorCodes: ["LINT_FAILED"] }
        },
        frontend: { apiPattern: "invoke_wrapper+typed_meta", stateManagement: "local", validation: "simple" }
      })
    ]);

    const result = await toolPackage.runtime.run(
      { goal: "Design impl", contract },
      {
        provider,
        runCmdImpl: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }),
        flags: { apply: true, verify: true, repair: true, maxPatchesPerTurn: 8 },
        memory: { patchPaths: [], touchedPaths: [] }
      }
    );

    expect(result.ok).toBe(true);
    const data = result.data as { impl: { rust: { services: Array<{ name: string }> } } };
    expect(data.impl.rust.services[0]?.name).toBe("lint_service");
  });
});
