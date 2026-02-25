import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runAgent } from "../src/agent/runtime.js";
import type { ContractDesignV1 } from "../src/agent/design/contract/schema.js";
import type { DeliveryDesignV1 } from "../src/agent/design/delivery/schema.js";
import type { ImplementationDesignV1 } from "../src/agent/design/implementation/schema.js";
import type { UXDesignV1 } from "../src/agent/design/ux/schema.js";
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

const mockUx: UXDesignV1 = {
  version: "v1",
  navigation: {
    kind: "sidebar",
    items: [{ id: "home", title: "Home", route: "/" }]
  },
  screens: [
    {
      id: "home",
      title: "Home",
      route: "/",
      purpose: "Overview",
      dataNeeds: [{ source: "command", command: "lint_config" }],
      actions: [{ label: "Run Lint", command: "lint_config" }],
      states: { loading: true, empty: "No data", error: "Failed" }
    }
  ]
};

const mockImpl: ImplementationDesignV1 = {
  version: "v1",
  rust: {
    layering: "commands_service_repo",
    services: [{ name: "lint_service", responsibilities: ["run lint"], usesTables: ["lint_runs"] }],
    repos: [{ name: "lint_repo", table: "lint_runs", operations: ["insert", "list"] }],
    errorModel: { pattern: "thiserror+ApiResponse", errorCodes: ["LINT_FAILED"] }
  },
  frontend: {
    apiPattern: "invoke_wrapper+typed_meta",
    stateManagement: "local",
    validation: "simple"
  }
};

const mockDelivery: DeliveryDesignV1 = {
  version: "v1",
  verifyPolicy: {
    levelDefault: "full",
    gates: ["pnpm_install_if_needed", "pnpm_build", "cargo_check", "tauri_help"]
  },
  preflight: {
    checks: [{ id: "node", description: "Node installed", cmd: "node --version", required: true }]
  },
  assets: {
    icons: { required: true, paths: ["src-tauri/icons/icon.png"] }
  }
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
  test("plan-only mode still runs design/materialize chain then DONE", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-agent-"));
    const specPath = await writeSpec(root);
    const outDir = join(root, "generated");

    const provider = new MockProvider(new Array(20).fill(emptyCalls));

    const result = await runAgent({
      goal: "plan only",
      specPath,
      outDir,
      apply: false,
      verify: false,
      repair: false,
      provider,
      maxTurns: 12,
      registryDeps: {
        runBootstrapProjectImpl: mockBootstrap,
        runDesignContractImpl: async () => ({ contract: mockContract, attempts: 1, raw: "{}" }),
        runMaterializeContractImpl: async ({ outDir: materializeOutDir }) => ({
          appDir: join(materializeOutDir, "agent-demo"),
          contractPath: join(materializeOutDir, "agent-demo", "forgetauri.contract.json"),
          summary: { wrote: 0, skipped: 3 }
        }),
        runDesignUxImpl: async () => ({ ux: mockUx, attempts: 1, raw: "{}" }),
        runMaterializeUxImpl: async ({ projectRoot }) => ({ uxPath: join(projectRoot, "src/lib/design/ux.json"), summary: { wrote: 0, skipped: 2 } }),
        runDesignImplementationImpl: async () => ({ impl: mockImpl, attempts: 1, raw: "{}" }),
        runMaterializeImplementationImpl: async ({ projectRoot }) => ({
          implPath: join(projectRoot, "src/lib/design/implementation.json"),
          summary: { wrote: 0, skipped: 2 }
        }),
        runDesignDeliveryImpl: async () => ({ delivery: mockDelivery, attempts: 1, raw: "{}" }),
        runMaterializeDeliveryImpl: async ({ projectRoot }) => ({
          deliveryPath: join(projectRoot, "src/lib/design/delivery.json"),
          summary: { wrote: 0, skipped: 4 }
        }),
        runValidateDesignImpl: async () => ({
          ok: true,
          errors: [],
          summary: "Design validation passed"
        }),
        runCodegenFromDesignImpl: async () => ({
          ok: true,
          generated: ["src/lib/api/generated/contract.ts"],
          summary: { wrote: 0, skipped: 1 }
        })
      }
    });

    expect(result.ok).toBe(true);
    expect(result.state.phase).toBe("DONE");
    expect(result.state.verifyHistory).toHaveLength(0);
    expect(result.state.contract?.version).toBe("v1");
    expect(result.state.ux?.version).toBe("v1");
    expect(result.state.impl?.version).toBe("v1");
    expect(result.state.delivery?.version).toBe("v1");
  });

  test("verify success follows full staged phases and ends DONE", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-agent-"));
    const specPath = await writeSpec(root);
    const outDir = join(root, "generated");

    const provider = new MockProvider(new Array(16).fill(emptyCalls));
    const phaseCalls: string[] = [];

    const result = await runAgent({
      goal: "bootstrap and verify",
      specPath,
      outDir,
      apply: true,
      verify: true,
      repair: true,
      provider,
      maxTurns: 16,
      registryDeps: {
        runBootstrapProjectImpl: async (input) => {
          phaseCalls.push("BOOT");
          return mockBootstrap(input);
        },
        runDesignContractImpl: async () => {
          phaseCalls.push("DESIGN_CONTRACT");
          return { contract: mockContract, attempts: 1, raw: "{}" };
        },
        runMaterializeContractImpl: async ({ outDir: materializeOutDir }) => {
          phaseCalls.push("MATERIALIZE_CONTRACT");
          return {
            appDir: join(materializeOutDir, "agent-demo"),
            contractPath: join(materializeOutDir, "agent-demo", "forgetauri.contract.json"),
            summary: { wrote: 0, skipped: 3 }
          };
        },
        runDesignUxImpl: async () => {
          phaseCalls.push("DESIGN_UX");
          return { ux: mockUx, attempts: 1, raw: "{}" };
        },
        runMaterializeUxImpl: async ({ projectRoot }) => {
          phaseCalls.push("MATERIALIZE_UX");
          return { uxPath: join(projectRoot, "src/lib/design/ux.json"), summary: { wrote: 0, skipped: 2 } };
        },
        runDesignImplementationImpl: async () => {
          phaseCalls.push("DESIGN_IMPL");
          return { impl: mockImpl, attempts: 1, raw: "{}" };
        },
        runMaterializeImplementationImpl: async ({ projectRoot }) => {
          phaseCalls.push("MATERIALIZE_IMPL");
          return {
            implPath: join(projectRoot, "src/lib/design/implementation.json"),
            summary: { wrote: 0, skipped: 2 }
          };
        },
        runDesignDeliveryImpl: async () => {
          phaseCalls.push("DESIGN_DELIVERY");
          return { delivery: mockDelivery, attempts: 1, raw: "{}" };
        },
        runMaterializeDeliveryImpl: async ({ projectRoot }) => {
          phaseCalls.push("MATERIALIZE_DELIVERY");
          return { deliveryPath: join(projectRoot, "src/lib/design/delivery.json"), summary: { wrote: 0, skipped: 4 } };
        },
        runValidateDesignImpl: async () => {
          phaseCalls.push("VALIDATE_DESIGN");
          return {
            ok: true,
            errors: [],
            summary: "Design validation passed"
          };
        },
        runCodegenFromDesignImpl: async ({ projectRoot }) => {
          phaseCalls.push("CODEGEN_FROM_DESIGN");
          expect(projectRoot).toContain("agent-demo");
          return {
            ok: true,
            generated: ["src/lib/api/generated/contract.ts", "src-tauri/src/commands/generated/lint_config.rs"],
            summary: { wrote: 1, skipped: 1 }
          };
        },
        runVerifyProjectImpl: async (input) => {
          phaseCalls.push("VERIFY");
          expect(input.projectRoot).toContain("agent-demo");
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
    expect(phaseCalls).toEqual([
      "BOOT",
      "DESIGN_CONTRACT",
      "MATERIALIZE_CONTRACT",
      "DESIGN_UX",
      "MATERIALIZE_UX",
      "DESIGN_IMPL",
      "MATERIALIZE_IMPL",
      "DESIGN_DELIVERY",
      "MATERIALIZE_DELIVERY",
      "VALIDATE_DESIGN",
      "CODEGEN_FROM_DESIGN",
      "VERIFY"
    ]);
    expect(result.state.contractPath).toContain("forgetauri.contract.json");
    expect(result.state.uxPath).toContain("ux.json");
    expect(result.state.implPath).toContain("implementation.json");
    expect(result.state.deliveryPath).toContain("delivery.json");
    expect(result.state.designValidation?.ok).toBe(true);
    expect(result.state.codegenSummary?.generatedFilesCount).toBe(2);
  });

  test("verify fail triggers repair and fails when repair budget exhausted", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-agent-"));
    const specPath = await writeSpec(root);
    const outDir = join(root, "generated");

    const provider = new MockProvider(new Array(20).fill(emptyCalls));

    let knownRepairCalls = 0;
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
      maxTurns: 20,
      maxPatches: 1,
      registryDeps: {
        runBootstrapProjectImpl: mockBootstrap,
        runDesignContractImpl: async () => ({ contract: mockContract, attempts: 1, raw: "{}" }),
        runMaterializeContractImpl: async ({ outDir: materializeOutDir }) => ({
          appDir: join(materializeOutDir, "agent-demo"),
          contractPath: join(materializeOutDir, "agent-demo", "forgetauri.contract.json"),
          summary: { wrote: 0, skipped: 3 }
        }),
        runDesignUxImpl: async () => ({ ux: mockUx, attempts: 1, raw: "{}" }),
        runMaterializeUxImpl: async ({ projectRoot }) => ({ uxPath: join(projectRoot, "src/lib/design/ux.json"), summary: { wrote: 0, skipped: 2 } }),
        runDesignImplementationImpl: async () => ({ impl: mockImpl, attempts: 1, raw: "{}" }),
        runMaterializeImplementationImpl: async ({ projectRoot }) => ({
          implPath: join(projectRoot, "src/lib/design/implementation.json"),
          summary: { wrote: 0, skipped: 2 }
        }),
        runDesignDeliveryImpl: async () => ({ delivery: mockDelivery, attempts: 1, raw: "{}" }),
        runMaterializeDeliveryImpl: async ({ projectRoot }) => ({
          deliveryPath: join(projectRoot, "src/lib/design/delivery.json"),
          summary: { wrote: 0, skipped: 4 }
        }),
        runValidateDesignImpl: async () => ({
          ok: true,
          errors: [],
          summary: "Design validation passed"
        }),
        runCodegenFromDesignImpl: async () => ({
          ok: true,
          generated: ["src/lib/api/generated/contract.ts"],
          summary: { wrote: 0, skipped: 1 }
        }),
        runVerifyProjectImpl: async () => failVerify,
        runRepairKnownIssuesImpl: async () => {
          knownRepairCalls += 1;
          return {
            ok: true,
            changed: false,
            fixes: [],
            summary: "No known deterministic issues found"
          };
        },
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

    expect(knownRepairCalls).toBeGreaterThan(0);
    expect(repairCalls).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
    expect(result.state.phase).toBe("FAILED");
    expect(result.state.budgets.usedRepairs).toBeGreaterThan(result.state.budgets.maxPatches);
    expect(result.state.budgets.usedPatches).toBe(result.state.budgets.usedRepairs);
  });

  test("requests human review when patch files are generated", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-agent-"));
    const specPath = await writeSpec(root);
    const outDir = join(root, "generated");
    const provider = new MockProvider(new Array(20).fill(emptyCalls));

    const result = await runAgent({
      goal: "verify then repair with human review",
      specPath,
      outDir,
      apply: true,
      verify: true,
      repair: true,
      provider,
      maxTurns: 20,
      registryDeps: {
        runBootstrapProjectImpl: mockBootstrap,
        runDesignContractImpl: async () => ({ contract: mockContract, attempts: 1, raw: "{}" }),
        runMaterializeContractImpl: async ({ outDir: materializeOutDir }) => ({
          appDir: join(materializeOutDir, "agent-demo"),
          contractPath: join(materializeOutDir, "agent-demo", "forgetauri.contract.json"),
          summary: { wrote: 0, skipped: 3 }
        }),
        runDesignUxImpl: async () => ({ ux: mockUx, attempts: 1, raw: "{}" }),
        runMaterializeUxImpl: async ({ projectRoot }) => ({ uxPath: join(projectRoot, "src/lib/design/ux.json"), summary: { wrote: 0, skipped: 2 } }),
        runDesignImplementationImpl: async () => ({ impl: mockImpl, attempts: 1, raw: "{}" }),
        runMaterializeImplementationImpl: async ({ projectRoot }) => ({
          implPath: join(projectRoot, "src/lib/design/implementation.json"),
          summary: { wrote: 0, skipped: 2 }
        }),
        runDesignDeliveryImpl: async () => ({ delivery: mockDelivery, attempts: 1, raw: "{}" }),
        runMaterializeDeliveryImpl: async ({ projectRoot }) => ({
          deliveryPath: join(projectRoot, "src/lib/design/delivery.json"),
          summary: { wrote: 0, skipped: 4 }
        }),
        runValidateDesignImpl: async () => ({
          ok: true,
          errors: [],
          summary: "Design validation passed"
        }),
        runCodegenFromDesignImpl: async () => ({
          ok: true,
          generated: ["src/lib/api/generated/contract.ts"],
          summary: { wrote: 0, skipped: 1 }
        }),
        runVerifyProjectImpl: async () => ({
          ok: false,
          step: "build",
          results: [
            { name: "install", ok: true, code: 0, stdout: "ok", stderr: "", skipped: true },
            { name: "install_retry", ok: true, code: 0, stdout: "skipped", stderr: "", skipped: true },
            { name: "build", ok: false, code: 1, stdout: "", stderr: "type error" },
            { name: "build_retry", ok: true, code: 0, stdout: "skipped", stderr: "", skipped: true },
            { name: "cargo_check", ok: true, code: 0, stdout: "skipped", stderr: "", skipped: true },
            { name: "tauri_check", ok: true, code: 0, stdout: "skipped", stderr: "", skipped: true },
            { name: "tauri_build", ok: true, code: 0, stdout: "skipped", stderr: "", skipped: true }
          ],
          summary: "verify failed at build",
          classifiedError: "TS",
          suggestion: "fix ts"
        }),
        runRepairKnownIssuesImpl: async () => ({
          ok: true,
          changed: false,
          fixes: [],
          summary: "No known deterministic issues found"
        }),
        repairOnceImpl: async () => ({
          ok: true,
          summary: "patched",
          audit: [],
          patchPaths: [join(outDir, "agent-demo", "generated/patches/src_App.svelte.patch")]
        })
      },
      humanReview: async () => false
    });

    expect(result.ok).toBe(false);
    expect(result.state.humanReviews.length).toBeGreaterThan(0);
    expect(result.state.humanReviews[0]?.approved).toBe(false);
    expect(result.summary).toContain("Human review rejected");
  });

  test("repair phase stops at known issues when deterministic fix changes files", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-agent-"));
    const specPath = await writeSpec(root);
    const outDir = join(root, "generated");
    const provider = new MockProvider(new Array(20).fill(emptyCalls));

    let knownCalls = 0;
    let repairOnceCalls = 0;
    let verifyCalls = 0;

    const verifyFailThenPass: VerifyProjectResult[] = [
      {
        ok: false,
        step: "tauri_build",
        results: [],
        summary: "verify failed at tauri build",
        classifiedError: "Tauri",
        suggestion: "fix config"
      },
      {
        ok: true,
        step: "none",
        results: [],
        summary: "ok",
        classifiedError: "Unknown",
        suggestion: ""
      }
    ];

    const result = await runAgent({
      goal: "known issues before llm repair",
      specPath,
      outDir,
      apply: true,
      verify: true,
      repair: true,
      provider,
      maxTurns: 20,
      registryDeps: {
        runBootstrapProjectImpl: mockBootstrap,
        runDesignContractImpl: async () => ({ contract: mockContract, attempts: 1, raw: "{}" }),
        runMaterializeContractImpl: async ({ outDir: materializeOutDir }) => ({
          appDir: join(materializeOutDir, "agent-demo"),
          contractPath: join(materializeOutDir, "agent-demo", "forgetauri.contract.json"),
          summary: { wrote: 0, skipped: 3 }
        }),
        runDesignUxImpl: async () => ({ ux: mockUx, attempts: 1, raw: "{}" }),
        runMaterializeUxImpl: async ({ projectRoot }) => ({ uxPath: join(projectRoot, "src/lib/design/ux.json"), summary: { wrote: 0, skipped: 2 } }),
        runDesignImplementationImpl: async () => ({ impl: mockImpl, attempts: 1, raw: "{}" }),
        runMaterializeImplementationImpl: async ({ projectRoot }) => ({
          implPath: join(projectRoot, "src/lib/design/implementation.json"),
          summary: { wrote: 0, skipped: 2 }
        }),
        runDesignDeliveryImpl: async () => ({ delivery: mockDelivery, attempts: 1, raw: "{}" }),
        runMaterializeDeliveryImpl: async ({ projectRoot }) => ({
          deliveryPath: join(projectRoot, "src/lib/design/delivery.json"),
          summary: { wrote: 0, skipped: 4 }
        }),
        runValidateDesignImpl: async () => ({
          ok: true,
          errors: [],
          summary: "Design validation passed"
        }),
        runCodegenFromDesignImpl: async () => ({
          ok: true,
          generated: ["src/lib/api/generated/contract.ts"],
          summary: { wrote: 0, skipped: 1 }
        }),
        runVerifyProjectImpl: async () => {
          const next = verifyFailThenPass[Math.min(verifyCalls, verifyFailThenPass.length - 1)]!;
          verifyCalls += 1;
          return next;
        },
        runRepairKnownIssuesImpl: async () => {
          knownCalls += 1;
          return {
            ok: true,
            changed: true,
            fixes: [{ id: "ensure_icon_png", message: "added icon", paths: [join(outDir, "agent-demo/src-tauri/icons/icon.png")] }],
            summary: "Applied 1 deterministic known-issue fix(es)"
          };
        },
        repairOnceImpl: async () => {
          repairOnceCalls += 1;
          return {
            ok: true,
            summary: "patched",
            audit: [],
            patchPaths: []
          };
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(knownCalls).toBeGreaterThan(0);
    expect(repairOnceCalls).toBe(0);
  });
});
