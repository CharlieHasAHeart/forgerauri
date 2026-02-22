import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { applyPlan } from "../src/generator/apply.js";
import { generateScaffold } from "../src/generator/scaffold/index.js";
import { toAppSlug } from "../src/generator/templates.js";
import type { SpecIR } from "../src/spec/schema.js";

const sampleSpec = (): SpecIR => ({
  app: { name: "Incremental Demo", one_liner: "incremental" },
  screens: [
    {
      name: "Main",
      purpose: "Home",
      primary_actions: ["Lint Config", "Apply Fixes", "Unknown Action"]
    }
  ],
  rust_commands: [
    {
      name: "lint_config",
      async: true,
      input: { file_path: "string", diagnostics: "json?" },
      output: { ok: "boolean", message: "string", diagnostics: "json", created_at: "timestamp" }
    },
    {
      name: "apply_fixes",
      async: true,
      input: { file_path: "string" },
      output: { ok: "boolean", message: "string", changed: "boolean", diff: "string", created_at: "timestamp" }
    }
  ],
  data_model: { tables: [] },
  acceptance_tests: [],
  mvp_plan: [],
  raw: {}
});

describe("incremental generation", () => {
  test("second generation is mostly skip with no user overwrite", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-inc-"));
    const spec = sampleSpec();

    const firstPlan = await generateScaffold(spec, outDir);
    await applyPlan(firstPlan, { apply: true });

    const secondPlan = await generateScaffold(spec, outDir);
    const skipCount = secondPlan.actions.filter((action) => action.type === "SKIP").length;
    const fileActionCount = secondPlan.actions.filter((action) => action.entryType === "file").length;

    expect(skipCount).toBeGreaterThan(Math.floor(fileActionCount * 0.8));
    expect(
      secondPlan.actions.some(
        (action) => action.path.endsWith("/src/App.svelte") && action.type === "OVERWRITE"
      )
    ).toBe(false);
  });

  test("user zone file gets PATCH and apply writes patch file", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-inc-"));
    const spec = sampleSpec();

    const firstPlan = await generateScaffold(spec, outDir);
    await applyPlan(firstPlan, { apply: true });

    const appDir = join(outDir, toAppSlug(spec.app.name));
    await writeFile(join(appDir, "src/App.svelte"), "<script>let custom = true;</script>\n<div>custom app</div>\n", "utf8");

    const nextPlan = await generateScaffold(spec, outDir);
    const appAction = nextPlan.actions.find((action) => action.path.endsWith("/src/App.svelte"));

    expect(appAction?.type).toBe("PATCH");

    const applyResult = await applyPlan(nextPlan, { apply: true });
    expect(applyResult.patchFiles.length).toBeGreaterThan(0);

    const appPatch = applyResult.patchFiles.find((path) => path.includes("App.svelte"));
    expect(appPatch).toBeDefined();

    const patchText = await readFile(appPatch!, "utf8");
    expect(patchText).toContain("--- a/src/App.svelte");
    expect(patchText).toContain("+++ b/src/App.svelte");
    expect(patchText).toContain("AppShell");
  });
});
