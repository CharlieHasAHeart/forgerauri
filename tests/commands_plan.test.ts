import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { generateScaffold } from "../src/generator/scaffold/index.js";
import { toAppSlug } from "../src/generator/templates.js";
import type { SpecIR } from "../src/spec/schema.js";

const specWithCommand = (): SpecIR => ({
  app: { name: "Commands Demo", one_liner: "cmd demo" },
  screens: [{ name: "Home", primary_actions: [] }],
  rust_commands: [
    {
      name: "connect_to_server",
      async: true,
      input: {
        server_url: "string",
        dry_run: "boolean?"
      },
      output: {
        ok: "boolean",
        message: "string",
        payload: "json?"
      }
    }
  ],
  data_model: {
    tables: [
      {
        name: "agents",
        columns: [
          { name: "id", type: "int" },
          { name: "name", type: "string" }
        ]
      }
    ]
  },
  acceptance_tests: [],
  mvp_plan: [],
  raw: {}
});

describe("commands plan", () => {
  test("includes command generation files", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-cmd-"));
    const plan = await generateScaffold(specWithCommand(), outDir);
    const appRoot = join(outDir, toAppSlug("Commands Demo"));
    const paths = plan.actions.map((action) => action.path);

    expect(paths).toContain(join(appRoot, "src-tauri/migrations/0003_command_runs.sql"));
    expect(paths).toContain(join(appRoot, "src-tauri/src/db/command_run_repo.rs"));
    expect(paths).toContain(join(appRoot, "src-tauri/src/commands/generated/connect_to_server.rs"));
    expect(paths).toContain(join(appRoot, "src/lib/api/generated/commands.ts"));
  });

  test("command files contain command_runs integration", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-cmd-"));
    const plan = await generateScaffold(specWithCommand(), outDir);

    const migration = plan.actions.find((action) => action.path.endsWith("/src-tauri/migrations/0003_command_runs.sql"));
    const commandFile = plan.actions.find((action) =>
      action.path.endsWith("/src-tauri/src/commands/generated/connect_to_server.rs")
    );
    const serviceFile = plan.actions.find((action) =>
      action.path.endsWith("/src-tauri/src/services/generated/connect_to_server.rs")
    );

    expect(migration?.content).toContain("CREATE TABLE IF NOT EXISTS command_runs");
    expect(commandFile?.content).toContain("run_connect_to_server");
    expect(serviceFile?.content).toContain("record_run");
  });
});
