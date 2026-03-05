import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createApplyStructuredEditsTool } from "../src/tools/patch/applyStructuredEdits.js";
import type { AgentState } from "../src/core/contracts/state.js";
import type { ToolRunContext } from "../src/core/contracts/tools.js";
import type { LlmPort } from "../src/core/contracts/llm.js";

const llm: LlmPort = { name: "test-llm", model: "test-model" };

const createState = (runDir: string): AgentState => ({
  goal: "test",
  specRef: "spec.json",
  runDir,
  status: "executing",
  usedLLM: false,
  verifyHistory: [],
  budgets: {
    maxTurns: 10,
    maxPatches: 10,
    usedTurns: 1,
    usedPatches: 0,
    usedRepairs: 0
  },
  patchPaths: [],
  humanReviews: [],
  lastDeterministicFixes: [],
  repairKnownChecked: false,
  touchedFiles: [],
  toolCalls: [],
  toolResults: [],
  planHistory: [],
  contextHistory: []
});

const shellRunner = async (cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }> =>
  await new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      const exit = code ?? 1;
      resolvePromise({ ok: exit === 0, code: exit, stdout, stderr });
    });
    child.on("error", (error) => {
      resolvePromise({ ok: false, code: 1, stdout, stderr: String(error) });
    });
  });

const createCtx = (runDir: string, appDir: string): ToolRunContext => ({
  provider: llm,
  runCmdImpl: shellRunner,
  flags: {
    maxPatchesPerTurn: 10
  },
  memory: {
    repoRoot: runDir,
    runDir,
    appDir,
    patchPaths: [],
    touchedPaths: [],
    blobs: {},
    filesFull: {}
  }
});

describe("apply_structured_edits tool", () => {
  it("supports checkOnly then apply for create/replace/delete edits", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "forge-test-run-"));
    const appDir = join(runDir, "app");
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, "a.txt"), "line1\nline2\n", "utf8");
    await writeFile(join(appDir, "b.txt"), "delete me\n", "utf8");

    const state = createState(runDir);
    state.appDir = appDir;
    state.currentTaskId = "t1";
    const ctx = createCtx(runDir, appDir);
    const tool = createApplyStructuredEditsTool();

    const input: unknown = {
      cwd: appDir,
      checkOnly: true,
      edits: [
        { kind: "replace_range", path: "a.txt", startLine: 2, endLine: 2, replacement: "forge" },
        { kind: "create_file", path: "c.txt", content: "new file\n" },
        { kind: "delete_file", path: "b.txt" }
      ]
    };

    const checked = await tool.run(input as never, ctx);
    expect(checked.ok).toBe(true);
    expect((checked.data as Record<string, unknown>).applied).toBe(false);
    const patchPath = String((checked.data as Record<string, unknown>).patchPath);
    const patchText = await readFile(patchPath, "utf8");
    expect(patchText.includes("@@")).toBe(true);

    const applied = await tool.run({ ...(input as Record<string, unknown>), checkOnly: false } as never, ctx);
    expect(applied.ok).toBe(true);
    expect((applied.data as Record<string, unknown>).applied).toBe(true);
    expect(await readFile(join(appDir, "a.txt"), "utf8")).toContain("forge");
    expect(await readFile(join(appDir, "c.txt"), "utf8")).toContain("new file");
  });

  it("returns structured error with stderrRef when git apply --check fails", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "forge-test-run-"));
    const appDir = join(runDir, "app");
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, "a.txt"), "x\n", "utf8");

    const state = createState(runDir);
    state.appDir = appDir;
    state.currentTaskId = "t2";
    const ctx = createCtx(runDir, appDir);
    const originalRunner = ctx.runCmdImpl;
    ctx.runCmdImpl = async (cmd, args, cwd) => {
      if (cmd === "git" && args[0] === "apply" && args[1] === "--check") {
        return { ok: false, code: 1, stdout: "", stderr: "synthetic apply check failure" };
      }
      return originalRunner(cmd, args, cwd);
    };

    const tool = createApplyStructuredEditsTool();
    const result = await tool.run(
      {
        cwd: appDir,
        edits: [{ kind: "replace_range", path: "a.txt", startLine: 1, endLine: 1, replacement: "y" }]
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PATCH_APPLY_CHECK_FAILED");
    const data = result.data as Record<string, unknown>;
    expect(typeof data.stderrRef).toBe("string");
    const stderrRef = String(data.stderrRef);
    const blobs = ctx.memory.blobs as Record<string, string>;
    expect(blobs[stderrRef]).toContain("synthetic apply check failure");
  });
});
