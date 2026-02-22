import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { generateScaffold } from "../src/generator/scaffold/index.js";
import { toAppSlug } from "../src/generator/templates.js";
import type { SpecIR } from "../src/spec/schema.js";

const specWithActions = (): SpecIR => ({
  app: { name: "UIB Demo", one_liner: "uia+b" },
  screens: [
    {
      name: "Main Screen",
      purpose: "Action execution",
      primary_actions: ["Lint Config", "Apply Fixes", "Unknown Action"]
    }
  ],
  rust_commands: [
    {
      name: "lint_config",
      async: true,
      input: { config_path: "string" },
      output: { ok: "boolean", message: "string" }
    },
    {
      name: "apply_fixes",
      async: true,
      input: { target: "string", dry_run: "boolean?" },
      output: { ok: "boolean", message: "string" }
    }
  ],
  data_model: { tables: [] },
  acceptance_tests: [],
  mvp_plan: [],
  raw: {}
});

describe("uiB plan", () => {
  test("generates action runner components and binding metadata", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-uib-"));
    const plan = await generateScaffold(specWithActions(), outDir);
    const appRoot = join(outDir, toAppSlug("UIB Demo"));
    const paths = plan.actions.map((action) => action.path);

    expect(paths).toContain(join(appRoot, "src/lib/components/generated/ActionRunner.svelte"));
    expect(paths).toContain(join(appRoot, "src/lib/components/generated/FieldForm.svelte"));
  });

  test("screen actions have deterministic bound_command values", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-uib-"));
    const plan = await generateScaffold(specWithActions(), outDir);

    const indexFile = plan.actions.find((action) => action.path.endsWith("/src/lib/screens/generated/index.ts"));
    const content = indexFile?.content ?? "";

    expect(content).toContain('label: "Lint Config"');
    expect(content).toContain('bound_command: "lint_config"');

    expect(content).toContain('label: "Apply Fixes"');
    expect(content).toContain('bound_command: "apply_fixes"');

    expect(content).toContain('label: "Unknown Action"');
    expect(content).toContain("bound_command: null");
  });
});
