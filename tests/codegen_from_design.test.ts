import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runCodegenFromDesign, toolPackage } from "../src/agent/tools/codegen_from_design/index.js";
import { MockProvider } from "./helpers/mockProvider.js";

const minimalContract = {
  version: "v1",
  app: { name: "Demo App" },
  commands: [
    {
      name: "lint_config",
      purpose: "Lint a config",
      inputs: [
        { name: "file_path", type: "string" },
        { name: "strict", type: "boolean", optional: true }
      ],
      outputs: [
        { name: "ok", type: "boolean" },
        { name: "diagnostics", type: "json", optional: true }
      ]
    },
    {
      name: "apply_fixes",
      purpose: "Apply fixes",
      inputs: [{ name: "file_path", type: "string" }],
      outputs: [{ name: "changed", type: "boolean" }]
    }
  ],
  dataModel: {
    tables: [
      {
        name: "lint_runs",
        columns: [{ name: "id", type: "integer", primaryKey: true }]
      }
    ],
    migrations: { strategy: "single" }
  },
  acceptance: {
    mustPass: ["pnpm_build"]
  }
};

const writeDesignArtifacts = async (projectRoot: string): Promise<void> => {
  await mkdir(join(projectRoot, "src/lib/design"), { recursive: true });
  await writeFile(join(projectRoot, "forgetauri.contract.json"), JSON.stringify(minimalContract, null, 2), "utf8");
  await writeFile(join(projectRoot, "src/lib/design/ux.json"), JSON.stringify({ version: "v1" }, null, 2), "utf8");
  await writeFile(
    join(projectRoot, "src/lib/design/implementation.json"),
    JSON.stringify({ version: "v1" }, null, 2),
    "utf8"
  );
  await writeFile(join(projectRoot, "src/lib/design/delivery.json"), JSON.stringify({ version: "v1" }, null, 2), "utf8");
};

describe("tool_codegen_from_design", () => {
  test("apply=true writes deterministic TS and Rust generated files", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-codegen-"));
    await writeDesignArtifacts(root);

    const result = await runCodegenFromDesign({
      projectRoot: root,
      apply: true
    });

    expect(result.ok).toBe(true);
    expect(result.generated).toContain("src/lib/api/generated/contract.ts");
    expect(result.generated).toContain("src-tauri/src/commands/generated/mod.rs");
    expect(result.generated).toContain("src-tauri/src/commands/generated/lint_config.rs");

    const tsPath = join(root, "src/lib/api/generated/contract.ts");
    const rustPath = join(root, "src-tauri/src/commands/generated/lint_config.rs");
    const modPath = join(root, "src-tauri/src/commands/generated/mod.rs");

    expect(existsSync(tsPath)).toBe(true);
    expect(existsSync(rustPath)).toBe(true);
    expect(existsSync(modPath)).toBe(true);

    const ts = await readFile(tsPath, "utf8");
    expect(ts).toContain("export type CommandName = 'apply_fixes' | 'lint_config';");
    expect(ts).toContain("strict?: boolean;");
    expect(ts).toContain("diagnostics?: unknown;");

    const rust = await readFile(rustPath, "utf8");
    expect(rust).toContain("pub async fn lint_config");
    expect(rust).toContain("TODO: implement lint_config");

    const second = await runCodegenFromDesign({
      projectRoot: root,
      apply: true
    });
    expect(second.summary.wrote).toBe(0);
    expect(second.summary.skipped).toBeGreaterThan(0);
  });

  test("fails with clear message when contract file is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-codegen-"));

    const result = await toolPackage.runtime.run(
      {
        projectRoot: root,
        apply: true
      },
      {
        provider: new MockProvider([]),
        runCmdImpl: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }),
        flags: { apply: true, verify: true, repair: true, maxPatchesPerTurn: 8 },
        memory: { patchPaths: [], touchedPaths: [] }
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("Missing required contract file");
  });
});
