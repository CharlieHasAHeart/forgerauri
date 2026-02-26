import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { implementOnce } from "../src/agent/workflows/implement/implementLoop.js";
import { MockProvider } from "./helpers/mockProvider.js";

const writeSpec = async (root: string): Promise<string> => {
  const specPath = join(root, "spec.json");
  const spec = {
    app: { name: "Impl Demo", one_liner: "demo" },
    screens: [{ name: "Home", purpose: "home", primary_actions: [] }],
    rust_commands: [{ name: "lint_config", purpose: "lint", async: true, input: {}, output: {} }],
    data_model: { tables: [] },
    acceptance_tests: [],
    mvp_plan: []
  };
  await writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
  return specPath;
};

describe("implement loop", () => {
  test("generated files overwrite, user files become patch, audit is written", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-impl-"));
    const project = join(root, "project");
    await mkdir(join(project, "src/lib/generated"), { recursive: true });
    await mkdir(join(project, "src"), { recursive: true });

    await writeFile(join(project, "src/lib/generated/AppShell.svelte"), "<main>old</main>\n", "utf8");
    await writeFile(join(project, "src/App.svelte"), "<main>user-old</main>\n", "utf8");

    const specPath = await writeSpec(root);
    const provider = new MockProvider([
      JSON.stringify({
        patches: [
          {
            filePath: "src/lib/generated/AppShell.svelte",
            newContent: "<main>new</main>\n",
            reason: "ui improvements"
          },
          {
            filePath: "src/App.svelte",
            newContent: "<script>/* suggestion */</script>\n<main>new entry</main>\n",
            reason: "wire shell"
          }
        ]
      })
    ]);

    const result = await implementOnce({
      projectRoot: project,
      specPath,
      target: { kind: "ui" },
      maxPatches: 6,
      apply: true,
      verify: false,
      repair: false,
      provider
    });

    expect(result.ok).toBe(true);

    const generatedText = await readFile(join(project, "src/lib/generated/AppShell.svelte"), "utf8");
    expect(generatedText).toContain("<main>new</main>");

    const userText = await readFile(join(project, "src/App.svelte"), "utf8");
    expect(userText).toContain("user-old");

    const patchDir = join(project, "generated/patches");
    expect(existsSync(patchDir)).toBe(true);
    const patchFiles = await readdir(patchDir);
    expect(patchFiles.length).toBeGreaterThan(0);

    const logDir = join(project, "generated/llm_logs");
    expect(existsSync(logDir)).toBe(true);
    const logs = await readdir(logDir);
    expect(logs.length).toBeGreaterThan(0);

    const logText = await readFile(join(logDir, logs[0]), "utf8");
    expect(logText).toContain('"type": "OVERWRITE"');
    expect(logText).toContain('"type": "PATCH"');
  });

  test("apply=false keeps files unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-impl-"));
    const project = join(root, "project");
    await mkdir(join(project, "src/lib/generated"), { recursive: true });
    await writeFile(join(project, "src/lib/generated/AppShell.svelte"), "<main>old</main>\n", "utf8");

    const specPath = await writeSpec(root);
    const provider = new MockProvider([
      JSON.stringify({
        patches: [
          {
            filePath: "src/lib/generated/AppShell.svelte",
            newContent: "<main>new</main>\n",
            reason: "ui improvements"
          }
        ]
      })
    ]);

    const result = await implementOnce({
      projectRoot: project,
      specPath,
      target: { kind: "ui" },
      maxPatches: 6,
      apply: false,
      verify: false,
      repair: false,
      provider
    });

    expect(result.applied).toBe(false);
    const current = await readFile(join(project, "src/lib/generated/AppShell.svelte"), "utf8");
    expect(current).toContain("old");
    expect(existsSync(join(project, "generated/patches"))).toBe(false);
  });
});
