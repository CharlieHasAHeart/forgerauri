import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DEFAULT_ACCEPTANCE_PIPELINE_ID, getAcceptancePipeline } from "../src/agent/core/acceptance/catalog.js";
import { runVerifyProject } from "../src/agent/tools/impl/verify_project.js";

describe("verify_project executes acceptance pipeline", () => {
  test("uses desktop_tauri_default command order and cwd policies", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-verify-pipeline-"));
    const tauriDir = join(root, "src-tauri");
    await mkdir(tauriDir, { recursive: true });

    const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const commandIds: string[] = [];
    const runCmdImpl = async (cmd: string, args: string[], cwd: string) => {
      calls.push({ cmd, args, cwd });
      return { ok: true, code: 0, stdout: "ok", stderr: "" };
    };

    const result = await runVerifyProject({
      projectRoot: root,
      runCmdImpl,
      runtimePaths: { repoRoot: root, appDir: root, tauriDir: tauriDir.replace(/\\/g, "/") },
      onCommandRun: (event) => commandIds.push(event.commandId)
    });

    expect(result.ok).toBe(true);
    const pipeline = getAcceptancePipeline(DEFAULT_ACCEPTANCE_PIPELINE_ID)!;
    const expectedSequence = pipeline.steps.map((step) => step.command_id);
    expect(commandIds).toEqual(expectedSequence);

    expect(calls[0]?.cwd).toBe(root);
    expect(calls[1]?.cwd).toBe(root);
    expect(calls[2]?.cwd.replace(/\\/g, "/")).toBe(`${root.replace(/\\/g, "/")}/src-tauri`);
    expect(calls[3]?.cwd).toBe(root);
    expect(calls[4]?.cwd).toBe(root);
  });
});
