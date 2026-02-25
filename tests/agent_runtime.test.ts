import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runAgent } from "../src/agent/runtime.js";
import type { ContractDesignV1 } from "../src/agent/contract/schema.js";
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

const mockContract: ContractDesignV1 = {
  version: "v1",
  app: { name: "Agent Demo" },
  commands: [
    {
      name: "lint_config",
      purpose: "lint",
      inputs: [{ name: "file_path", type: "string" }],
      outputs: [{ name: "ok", type: "boolean" }]
    }
  ],
  dataModel: {
    tables: [
      {
        name: "lint_runs",
        columns: [{ name: "id", type: "integer", primaryKey: true }]
      }
    ],
    migrations: { strategy: "single" }
  },
  acceptance: { mustPass: ["pnpm_build", "cargo_check"] }
};

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
  test("plan-only mode ends in DONE after BOOT", async () => {
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
    expect(result.state.verifyHistory).toHaveLength(0);
    expect(result.state.contract).toBeUndefined();
  });

  test("verify success follows BOOT->DESIGN->MATERIALIZE->VERIFY->DONE", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-agent-"));
    const specPath = await writeSpec(root);
    const outDir = join(root, "generated");

    const provider = new MockProvider([emptyCalls, emptyCalls, emptyCalls, emptyCalls]);
    const phaseCalls: string[] = [];

    const result = await runAgent({
      goal: "bootstrap and verify",
      specPath,
      outDir,
      apply: true,
      verify: true,
      verifyLevel: "full",
      repair: true,
      provider,
      maxTurns: 6,
      registryDeps: {
        runBootstrapProjectImpl: async (input) => {
          phaseCalls.push("BOOT");
          return mockBootstrap(input);
        },
        runDesignContractImpl: async () => {
          phaseCalls.push("DESIGN");
          return { contract: mockContract, attempts: 1, raw: "{}" };
        },
        runMaterializeContractImpl: async ({ outDir: materializeOutDir }) => {
          phaseCalls.push("MATERIALIZE");
          return {
            appDir: join(materializeOutDir, "agent-demo"),
            contractPath: join(materializeOutDir, "agent-demo", "forgetauri.contract.json"),
            summary: { wrote: 0, skipped: 3 }
          };
        },
        runVerifyProjectImpl: async (input) => {
          phaseCalls.push("VERIFY");
          expect(input.verifyLevel).toBe("full");
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
    expect(phaseCalls).toEqual(["BOOT", "DESIGN", "MATERIALIZE", "VERIFY"]);
    expect(result.state.contract?.version).toBe("v1");
    expect(result.state.contractPath).toContain("forgetauri.contract.json");
  });

  test("verify fail triggers repair and fails when repair budget exhausted", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-agent-"));
    const specPath = await writeSpec(root);
    const outDir = join(root, "generated");

    const provider = new MockProvider([emptyCalls, emptyCalls, emptyCalls, emptyCalls, emptyCalls, emptyCalls]);

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
      maxTurns: 8,
      maxPatches: 1,
      registryDeps: {
        runBootstrapProjectImpl: mockBootstrap,
        runDesignContractImpl: async () => ({ contract: mockContract, attempts: 1, raw: "{}" }),
        runMaterializeContractImpl: async ({ outDir: materializeOutDir }) => ({
          appDir: join(materializeOutDir, "agent-demo"),
          contractPath: join(materializeOutDir, "agent-demo", "forgetauri.contract.json"),
          summary: { wrote: 0, skipped: 3 }
        }),
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
