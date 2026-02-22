import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { generateScaffold } from "../src/generator/scaffold/index.js";
import { toAppSlug } from "../src/generator/templates.js";
import type { SpecIR } from "../src/spec/schema.js";

const specWithBusiness = (): SpecIR => ({
  app: { name: "Business Demo", one_liner: "business" },
  screens: [
    {
      name: "Main",
      purpose: "Run commands",
      primary_actions: ["Lint Config", "Apply Fixes", "List Lint Runs"]
    }
  ],
  rust_commands: [
    {
      name: "lint_config",
      async: true,
      input: {
        file_path: "string",
        tool_type: "string?",
        diagnostics: "json?"
      },
      output: {
        ok: "boolean",
        message: "string",
        diagnostics: "json",
        created_at: "timestamp"
      }
    },
    {
      name: "apply_fixes",
      async: true,
      input: {
        file_path: "string",
        tool_type: "string?"
      },
      output: {
        ok: "boolean",
        message: "string",
        changed: "boolean",
        diff: "string",
        created_at: "timestamp"
      }
    }
  ],
  data_model: { tables: [] },
  acceptance_tests: [],
  mvp_plan: [],
  raw: {}
});

describe("business plan", () => {
  test("includes business migrations, repos, services and upgraded commands", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-biz-"));
    const plan = await generateScaffold(specWithBusiness(), outDir);
    const appRoot = join(outDir, toAppSlug("Business Demo"));
    const paths = plan.actions.map((action) => action.path);

    expect(paths).toContain(join(appRoot, "src-tauri/migrations/0004_business.sql"));
    expect(paths).toContain(join(appRoot, "src-tauri/src/db/lint_repo.rs"));
    expect(paths).toContain(join(appRoot, "src-tauri/src/services/lint_service.rs"));
    expect(paths).toContain(join(appRoot, "src-tauri/src/commands/generated/lint_config.rs"));

    expect(paths).toContain(join(appRoot, "src-tauri/src/db/fix_repo.rs"));
    expect(paths).toContain(join(appRoot, "src-tauri/src/services/fix_service.rs"));
    expect(paths).toContain(join(appRoot, "src-tauri/src/commands/generated/apply_fixes.rs"));

    expect(paths).toContain(join(appRoot, "src-tauri/src/commands/generated/list_lint_runs.rs"));
    expect(paths).toContain(join(appRoot, "src-tauri/src/commands/generated/list_fix_runs.rs"));
  });

  test("contains expected SQL and business call keywords", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-biz-"));
    const plan = await generateScaffold(specWithBusiness(), outDir);

    const sql = plan.actions.find((action) => action.path.endsWith("/src-tauri/migrations/0004_business.sql"));
    const lintCmd = plan.actions.find((action) => action.path.endsWith("/src-tauri/src/commands/generated/lint_config.rs"));
    const applyCmd = plan.actions.find((action) => action.path.endsWith("/src-tauri/src/commands/generated/apply_fixes.rs"));

    expect(sql?.content).toContain("CREATE TABLE IF NOT EXISTS lint_runs");
    expect(sql?.content).toContain("CREATE TABLE IF NOT EXISTS fix_runs");

    expect(lintCmd?.content).toContain("run_lint");
    expect(applyCmd?.content).toContain("run_apply_fixes");
  });
});
