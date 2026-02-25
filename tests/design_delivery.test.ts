import { describe, expect, test } from "vitest";
import { toolPackage } from "../src/agent/tools/design_delivery/index.js";
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
  dataModel: { tables: [], migrations: { strategy: "single" } },
  acceptance: { mustPass: ["pnpm_build"] }
};

describe("tool_design_delivery", () => {
  test("returns validated delivery design", async () => {
    const provider = new MockProvider([
      JSON.stringify({
        version: "v1",
        verifyPolicy: {
          levelDefault: "full",
          gates: ["pnpm_install_if_needed", "pnpm_build", "cargo_check", "tauri_help"],
          smokeCommands: ["lint_config"]
        },
        preflight: { checks: [{ id: "node", description: "Node installed", cmd: "node --version", required: true }] },
        assets: { icons: { required: true, paths: ["src-tauri/icons/icon.png"] } }
      })
    ]);

    const result = await toolPackage.runtime.run(
      { goal: "Design delivery", contract },
      {
        provider,
        runCmdImpl: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }),
        flags: { apply: true, verify: true, repair: true, maxPatchesPerTurn: 8 },
        memory: { patchPaths: [], touchedPaths: [] }
      }
    );

    expect(result.ok).toBe(true);
    const data = result.data as { delivery: { verifyPolicy: { levelDefault: string } } };
    expect(data.delivery.verifyPolicy.levelDefault).toBe("full");
  });
});
