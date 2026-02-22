import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runAgent } from "../src/agent/runtime.js";
import { toAppSlug } from "../src/generator/templates.js";
import { MockProvider } from "../src/llm/providers/mock.js";

const writeSpec = async (root: string): Promise<string> => {
  const spec = {
    app: { name: "Agent Demo", one_liner: "demo" },
    screens: [{ name: "Home", purpose: "home", primary_actions: [] }],
    rust_commands: [{ name: "lint_config", async: true, input: {}, output: {} }],
    data_model: { tables: [] },
    acceptance_tests: [],
    mvp_plan: []
  };
  const specPath = join(root, "spec.json");
  await writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
  return specPath;
};

describe("agent runtime", () => {
  test("runs tool loop and respects user-zone patch policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-agent-"));
    const outDir = join(root, "generated");
    const specPath = await writeSpec(root);

    const appSlug = toAppSlug("Agent Demo");
    const appDir = join(outDir, appSlug);
    await mkdir(join(appDir, "src"), { recursive: true });
    await writeFile(join(appDir, "src/App.svelte"), "<main>my custom app</main>\n", "utf8");

    const provider = new MockProvider([
      JSON.stringify({
        toolCalls: [
          { name: "tool_load_spec", input: { specPath } },
          { name: "tool_build_plan", input: { specPath, outDir } }
        ]
      }),
      JSON.stringify({
        toolCalls: [{ name: "tool_apply_plan", input: { outDir } }]
      }),
      JSON.stringify({
        toolCalls: [
          {
            name: "tool_run_cmd",
            input: {
              cwd: appDir,
              cmd: "node",
              args: ["-e", "process.exit(0)"]
            }
          }
        ]
      })
    ]);

    const result = await runAgent({
      goal: "generate app and verify",
      specPath,
      outDir,
      apply: true,
      verify: true,
      repair: true,
      provider
    });

    expect(result.ok).toBe(true);
    expect(result.auditPath).toBeTruthy();
    expect(result.patchPaths && result.patchPaths.length > 0).toBe(true);

    const appText = await readFile(join(appDir, "src/App.svelte"), "utf8");
    expect(appText).toContain("my custom app");

    const patchPath = (result.patchPaths ?? [])[0];
    expect(patchPath).toBeTruthy();
    if (patchPath) {
      expect(existsSync(patchPath)).toBe(true);
      const patch = await readFile(patchPath, "utf8");
      expect(patch).toContain("src/App.svelte");
    }

    const auditPath = result.auditPath as string;
    const auditText = await readFile(auditPath, "utf8");
    expect(auditText).toContain("tool_load_spec");
    expect(auditText).toContain("tool_build_plan");
    expect(auditText).toContain("tool_apply_plan");
    expect(auditText).toContain("tool_run_cmd");
  });
});
