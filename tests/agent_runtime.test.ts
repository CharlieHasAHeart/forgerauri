import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runAgent } from "../src/agent/runtime.js";
import type { BootstrapProjectResult, VerifyProjectResult } from "../src/agent/types.js";
import { MockProvider } from "./helpers/mockProvider.js";

const writeSpec = async (root: string): Promise<string> => {
  const specPath = join(root, "spec.json");
  const spec = {
    app: { name: "Agent Demo", one_liner: "demo" },
    screens: [{ name: "Home", purpose: "home", primary_actions: [] }],
    rust_commands: [{ name: "lint_config", async: true, input: {}, output: {} }],
    data_model: { tables: [] },
    acceptance_tests: [],
    mvp_plan: []
  };
  await writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
  return specPath;
};

const emptyCalls = JSON.stringify({ toolCalls: [] });

const mockBootstrap = async (input: {
  specPath: string;
  outDir: string;
  apply: boolean;
}): Promise<BootstrapProjectResult> => ({
  ok: true,
  appDir: join(input.outDir, "agent-demo"),
  usedLLM: true,
  planSummary: { create: 1, overwrite: 0, skip: 0, patch: 0 },
  applySummary: { create: 1, overwrite: 0, skip: 0, patch: 0, patchPaths: [], applied: input.apply }
});

describe("agent runtime", () => {
  test("plan-only mode ends in DONE", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-agent-"));
    const specPath = await writeSpec(root);
    const outDir = join(root, "generated");

    const provider = new MockProvider([emptyCalls]);

    const result = await runAgent({
      goal: "plan only",
      specPath,
      outDir,
      apply: false,
      verify: false,
      repair: false,
      provider,
      maxTurns: 2,
      registryDeps: {
        runBootstrapProjectImpl: mockBootstrap
      }
    });

    expect(result.ok).toBe(true);
    expect(result.state.phase).toBe("DONE");
  });

  test("verify ok ends in DONE and forwards verifyLevel", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-agent-"));
    const specPath = await writeSpec(root);
    const outDir = join(root, "generated");

    const provider = new MockProvider([emptyCalls, emptyCalls]);
    const verifyInputs: Array<{ projectRoot: string; verifyLevel: "basic" | "full" }> = [];

    const result = await runAgent({
      goal: "bootstrap and verify",
      specPath,
      outDir,
      apply: true,
      verify: true,
      verifyLevel: "full",
      repair: true,
      provider,
      maxTurns: 4,
      registryDeps: {
        runBootstrapProjectImpl: mockBootstrap,
        runVerifyProjectImpl: async (input) => {
          verifyInputs.push({ projectRoot: input.projectRoot, verifyLevel: input.verifyLevel });
          return {
            ok: true,
            step: "none",
            results: [],
            summary: "ok",
            classifiedError: "Unknown",
            suggestion: ""
          } satisfies VerifyProjectResult;
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.state.phase).toBe("DONE");
    expect(verifyInputs.length).toBeGreaterThan(0);
    expect(verifyInputs[0]?.verifyLevel).toBe("full");
  });

  test("verify fail triggers repair and fails when repair budget exhausted", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-agent-"));
    const specPath = await writeSpec(root);
    const outDir = join(root, "generated");

    const provider = new MockProvider([emptyCalls, emptyCalls, emptyCalls, emptyCalls]);

    let repairCalls = 0;

    const failVerify: VerifyProjectResult = {
      ok: false,
      step: "build",
      results: [
        { name: "install", ok: true, code: 0, stdout: "ok", stderr: "", skipped: true },
        { name: "install_retry", ok: true, code: 0, stdout: "skipped", stderr: "", skipped: true },
        { name: "build", ok: false, code: 1, stdout: "", stderr: "type error" },
        { name: "build_retry", ok: true, code: 0, stdout: "skipped", stderr: "", skipped: true },
        { name: "cargo_check", ok: true, code: 0, stdout: "skipped", stderr: "", skipped: true },
        { name: "tauri_check", ok: true, code: 0, stdout: "skipped", stderr: "", skipped: true }
      ],
      summary: "verify failed at build",
      classifiedError: "TS",
      suggestion: "fix ts"
    };

    const result = await runAgent({
      goal: "verify then repair",
      specPath,
      outDir,
      apply: true,
      verify: true,
      repair: true,
      provider,
      maxTurns: 6,
      maxPatches: 1,
      registryDeps: {
        runBootstrapProjectImpl: mockBootstrap,
        runVerifyProjectImpl: async () => failVerify,
        repairOnceImpl: async () => {
          repairCalls += 1;
          return {
            ok: true,
            summary: "patched",
            audit: [],
            patchPaths: []
          };
        }
      },
      runCmdImpl: async () => ({ ok: false, code: 1, stdout: "", stderr: "fail" })
    });

    expect(repairCalls).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
    expect(result.state.phase).toBe("FAILED");
    expect(result.state.budgets.usedRepairs).toBeGreaterThan(result.state.budgets.maxPatches);
    expect(result.state.budgets.usedPatches).toBe(result.state.budgets.usedRepairs);
  });
});
