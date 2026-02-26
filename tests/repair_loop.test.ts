import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { MockProvider } from "./helpers/mockProvider.js";
import { repairOnce } from "../src/agent/workflows/repair/repairLoop.js";

describe("repair loop", () => {
  test("generated file overwrite and user file patch", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-repair-"));
    await mkdir(join(root, "src/lib/generated"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });

    await writeFile(join(root, "src/lib/generated/demo.ts"), "export const x = 1;\n", "utf8");
    await writeFile(join(root, "src/App.svelte"), "<div>custom</div>\n", "utf8");

    const provider = new MockProvider([
      JSON.stringify({
        patches: [
          {
            filePath: "src/lib/generated/demo.ts",
            newContent: "export const x = 2;\n",
            reason: "fix generated"
          },
          {
            filePath: "src/App.svelte",
            newContent: '<script lang="ts">\n  import AppShell from "./lib/generated/AppShell.svelte";\n</script>\n\n<AppShell />\n',
            reason: "wire app shell"
          }
        ]
      })
    ]);

    let runCount = 0;
    const result = await repairOnce({
      projectRoot: root,
      cmd: "pnpm",
      args: ["test"],
      provider,
      runImpl: async () => {
        runCount += 1;
        if (runCount === 1) {
          return { ok: false, code: 1, stdout: "", stderr: "error in src/App.svelte" };
        }
        return { ok: true, code: 0, stdout: "ok", stderr: "" };
      }
    });

    expect(result.ok).toBe(true);

    const generatedContent = await readFile(join(root, "src/lib/generated/demo.ts"), "utf8");
    expect(generatedContent).toContain("x = 2");

    const patchDir = join(root, "generated/patches");
    const patchFiles = await readdir(patchDir);
    expect(patchFiles.length).toBeGreaterThan(0);

    const patchText = await readFile(join(patchDir, patchFiles[0]), "utf8");
    expect(patchText).toContain("--- a/src/App.svelte");
    expect(patchText).toContain("+++ b/src/App.svelte");
  });
});
