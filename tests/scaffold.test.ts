import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { applyPlan } from "../src/generator/apply.js";
import { buildPlan } from "../src/generator/plan.js";
import { toAppSlug } from "../src/generator/templates.js";
import type { SpecIR } from "../src/spec/schema.js";

const createSpec = (): SpecIR => ({
  app: { name: "Demo App", one_liner: "demo" },
  screens: [{ name: "Home", primary_actions: [] }],
  rust_commands: [{ name: "ping", async: true, input: {}, output: {} }],
  data_model: { tables: [] },
  acceptance_tests: [],
  mvp_plan: [],
  raw: {}
});

describe("scaffold plan", () => {
  test("contains key files for generated tauri app", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-out-"));
    const plan = buildPlan(createSpec(), outDir);

    const paths = plan.actions.map((action) => action.path);
    const appRoot = join(outDir, toAppSlug("Demo App"));

    expect(paths).toContain(join(appRoot, "package.json"));
    expect(paths).toContain(join(appRoot, "src-tauri/src/main.rs"));
    expect(paths).toContain(join(appRoot, "src/App.svelte"));
  });

  test("idempotent: second plan marks unchanged files as skip", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-out-"));
    const spec = createSpec();

    const firstPlan = buildPlan(spec, outDir);
    await applyPlan(firstPlan, { apply: true });

    const secondPlan = buildPlan(spec, outDir);

    const skipUnchanged = secondPlan.actions.filter(
      (action) => action.type === "SKIP" && action.reason === "unchanged"
    );

    expect(skipUnchanged.length).toBeGreaterThan(0);
    expect(
      secondPlan.actions.some(
        (action) => action.path.endsWith("/package.json") && action.type === "SKIP" && action.reason === "unchanged"
      )
    ).toBe(true);
  });
});
