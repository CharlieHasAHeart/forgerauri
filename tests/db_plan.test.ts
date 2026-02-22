import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { generateScaffold } from "../src/generator/scaffold/index.js";
import { toAppSlug } from "../src/generator/templates.js";
import type { SpecIR } from "../src/spec/schema.js";

const specWithTable = (): SpecIR => ({
  app: { name: "DB Demo", one_liner: "db demo" },
  screens: [{ name: "Home", primary_actions: [] }],
  rust_commands: [{ name: "ping", async: true, input: {}, output: {} }],
  data_model: {
    tables: [
      {
        name: "users",
        columns: [
          { name: "id", type: "int" },
          { name: "created_at", type: "timestamp" }
        ]
      }
    ]
  },
  acceptance_tests: [],
  mvp_plan: [],
  raw: {}
});

describe("db plan", () => {
  test("includes DB migration and command files", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-db-"));
    const plan = await generateScaffold(specWithTable(), outDir);

    const appRoot = join(outDir, toAppSlug("DB Demo"));
    const paths = plan.actions.map((action) => action.path);

    expect(paths).toContain(join(appRoot, "src-tauri/migrations/0001_init.sql"));
    expect(paths).toContain(join(appRoot, "src-tauri/migrations/0002_tables.sql"));
    expect(paths).toContain(join(appRoot, "src-tauri/src/db/migrate.rs"));
    expect(paths).toContain(join(appRoot, "src-tauri/src/commands/db.rs"));
  });

  test("0002 migration contains table and columns from spec", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-db-"));
    const plan = await generateScaffold(specWithTable(), outDir);

    const migration = plan.actions.find((action) => action.path.endsWith("/src-tauri/migrations/0002_tables.sql"));

    expect(migration).toBeDefined();
    expect(migration?.content).toContain("CREATE TABLE IF NOT EXISTS \"users\"");
    expect(migration?.content).toContain("\"id\" INTEGER");
    expect(migration?.content).toContain("\"created_at\" TEXT");
  });
});
