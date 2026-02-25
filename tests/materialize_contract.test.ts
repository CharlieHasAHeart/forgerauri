import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runMaterializeContract } from "../src/agent/tools/materialize_contract/index.js";
import type { ContractDesignV1 } from "../src/agent/contract/schema.js";

const minimalContract: ContractDesignV1 = {
  version: "v1",
  app: { name: "MacroGraph" },
  commands: [
    {
      name: "lint_config",
      purpose: "lint config",
      inputs: [{ name: "file_path", type: "string" }],
      outputs: [{ name: "ok", type: "boolean" }]
    }
  ],
  dataModel: {
    tables: [
      {
        name: "lint_runs",
        columns: [
          { name: "id", type: "integer", primaryKey: true },
          { name: "file_path", type: "text" }
        ],
        indices: [{ name: "idx_lint_runs_file_path", columns: ["file_path"] }]
      }
    ],
    migrations: { strategy: "single" }
  },
  acceptance: {
    mustPass: ["pnpm_build", "cargo_check"],
    smokeCommands: ["lint_config"]
  }
};

describe("tool_materialize_contract", () => {
  test("apply=false returns target paths without writing files", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-contract-"));
    const result = await runMaterializeContract({
      contract: minimalContract,
      outDir,
      apply: false
    });

    expect(result.appDir).toBe(join(outDir, "macrograph"));
    expect(result.summary.wrote).toBe(0);
    expect(existsSync(result.contractPath)).toBe(false);
  });

  test("apply=true writes contract and sql files", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-contract-"));
    const result = await runMaterializeContract({
      contract: minimalContract,
      outDir,
      apply: true
    });

    const contractPath = join(result.appDir, "forgetauri.contract.json");
    const sqlPath = join(result.appDir, "src-tauri/migrations/0004_contract.sql");

    expect(existsSync(contractPath)).toBe(true);
    expect(existsSync(sqlPath)).toBe(true);

    const sql = await readFile(sqlPath, "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS \"lint_runs\"");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS \"idx_lint_runs_file_path\"");
  });
});
