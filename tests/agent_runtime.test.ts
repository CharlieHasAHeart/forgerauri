import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runAgent } from "../src/agent/runtime.js";
import type { VerifyProjectResult } from "../src/agent/types.js";
import { MockProvider } from "../src/llm/providers/mock.js";

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
      maxTurns: 2
    });

    expect(result.ok).toBe(true);
    expect(result.state.phase).toBe("DONE");
  });

  test("verify success ends in DONE", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-agent-"));
    const specPath = await writeSpec(root);
    const outDir = join(root, "generated");

    const provider = new MockProvider([emptyCalls, emptyCalls]);

    const result = await runAgent({
      goal: "bootstrap and verify",
      specPath,
      outDir,
      apply: true,
      verify: true,
      repair: true,
      provider,
      runCmdImpl: async () => ({ ok: true, code: 0, stdout: "ok", stderr: "" }),
      maxTurns: 4
    });

    expect(result.ok).toBe(true);
    expect(result.state.phase).toBe("DONE");
    expect(result.state.verifyHistory.length).toBeGreaterThan(0);
    expect(result.state.verifyHistory[result.state.verifyHistory.length - 1]?.ok).toBe(true);
  });

  test("verify fail with repair attempts and budget exhaustion ends in FAILED", async () => {
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
        { name: "build", ok: false, code: 1, stdout: "", stderr: "type error" }
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
        runVerifyProjectImpl: async () => failVerify,
        repairOnceImpl: async () => {
          repairCalls += 1;
          return {
            ok: true,
            summary: "patched",
            audit: [],
            patchPaths: [join(outDir, `p${repairCalls}.patch`)]
          };
        }
      },
      runCmdImpl: async () => ({ ok: false, code: 1, stdout: "", stderr: "fail" })
    });

    expect(repairCalls).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
    expect(result.state.phase).toBe("FAILED");
    expect(result.state.budgets.usedPatches).toBeGreaterThan(result.state.budgets.maxPatches);
  });
});
