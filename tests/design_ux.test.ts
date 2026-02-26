import { describe, expect, test } from "vitest";
import { toolPackage } from "../src/agent/tools/core/design_ux/index.js";
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

describe("tool_design_ux", () => {
  test("returns validated UX design", async () => {
    const provider = new MockProvider([
      JSON.stringify({
        version: "v1",
        navigation: { kind: "sidebar", items: [{ id: "home", title: "Home", route: "/" }] },
        screens: [
          {
            id: "home",
            title: "Home",
            route: "/",
            purpose: "Overview",
            dataNeeds: [{ source: "command", command: "lint_config" }],
            actions: [{ label: "Lint", command: "lint_config" }],
            states: { loading: true, empty: "No data", error: "Error" }
          }
        ]
      })
    ]);

    const result = await toolPackage.runtime.run(
      {
        goal: "Design UX",
        specPath: "/tmp/spec.json",
        contract
      },
      {
        provider,
        runCmdImpl: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }),
        flags: { apply: true, verify: true, repair: true, maxPatchesPerTurn: 8 },
        memory: { patchPaths: [], touchedPaths: [] }
      }
    );

    expect(result.ok).toBe(true);
    const data = result.data as { ux: { screens: Array<{ id: string }> } };
    expect(data.ux.screens[0]?.id).toBe("home");
  });
});
