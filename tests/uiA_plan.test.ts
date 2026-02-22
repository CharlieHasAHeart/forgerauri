import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { generateScaffold } from "../src/generator/scaffold/index.js";
import { toScreenSlug } from "../src/generator/ui/slug.js";
import { toAppSlug } from "../src/generator/templates.js";
import type { SpecIR } from "../src/spec/schema.js";

const specWithScreens = (): SpecIR => ({
  app: { name: "UIA Demo", one_liner: "uia" },
  screens: [
    {
      name: "Settings Panel",
      purpose: "Manage settings",
      primary_actions: ["save settings", "reset"]
    },
    {
      name: "Agent Overview",
      purpose: "Inspect agents",
      primary_actions: ["refresh list"]
    }
  ],
  rust_commands: [
    {
      name: "connect_to_server",
      async: true,
      input: { endpoint: "string" },
      output: { ok: "boolean", message: "string" }
    }
  ],
  data_model: { tables: [] },
  acceptance_tests: [],
  mvp_plan: [],
  raw: {}
});

describe("uiA plan", () => {
  test("includes generated screens index/files and app shell", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-uia-"));
    const plan = await generateScaffold(specWithScreens(), outDir);
    const appRoot = join(outDir, toAppSlug("UIA Demo"));
    const paths = plan.actions.map((action) => action.path);

    expect(paths).toContain(join(appRoot, "src/lib/screens/generated/index.ts"));
    expect(paths).toContain(join(appRoot, `src/lib/screens/generated/${toScreenSlug("Settings Panel")}.svelte`));
    expect(paths).toContain(join(appRoot, `src/lib/screens/generated/${toScreenSlug("Agent Overview")}.svelte`));
    expect(paths).toContain(join(appRoot, "src/App.svelte"));
  });

  test("screen index contains sorted screens metadata", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-uia-"));
    const plan = await generateScaffold(specWithScreens(), outDir);

    const indexFile = plan.actions.find((action) => action.path.endsWith("/src/lib/screens/generated/index.ts"));
    const content = indexFile?.content ?? "";

    const posAgent = content.indexOf('name: "Agent Overview"');
    const posSettings = content.indexOf('name: "Settings Panel"');

    expect(posAgent).toBeGreaterThan(-1);
    expect(posSettings).toBeGreaterThan(-1);
    expect(posAgent).toBeLessThan(posSettings);
    expect(content).toContain('slug: "agent-overview"');
    expect(content).toContain('purpose: "Inspect agents"');
    expect(content).toContain('primary_actions: ["refresh list"]');
  });
});
