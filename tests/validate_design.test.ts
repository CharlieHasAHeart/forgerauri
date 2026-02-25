import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runValidateDesign, toolPackage } from "../src/agent/tools/validate_design/index.js";
import { MockProvider } from "./helpers/mockProvider.js";

const baseContract = {
  version: "v1",
  app: { name: "Demo" },
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
        name: "runs",
        columns: [{ name: "id", type: "integer", primaryKey: true }]
      }
    ],
    migrations: { strategy: "single" }
  },
  acceptance: {
    mustPass: ["pnpm_build"]
  }
};

const baseUx = {
  version: "v1",
  navigation: { kind: "single", items: [{ id: "home", title: "Home", route: "/" }] },
  screens: [
    {
      id: "home",
      title: "Home",
      route: "/",
      purpose: "main",
      dataNeeds: [{ source: "command", command: "lint_config" }],
      actions: [{ label: "Lint", command: "lint_config" }],
      states: { loading: true, empty: "none", error: "err" }
    }
  ]
};

const baseImplementation = {
  version: "v1",
  rust: {
    layering: "commands_service_repo",
    services: [{ name: "lint_service", responsibilities: ["lint"], usesTables: ["runs"] }],
    repos: [{ name: "run_repo", table: "runs", operations: ["insert", "list"] }],
    errorModel: { pattern: "thiserror+ApiResponse", errorCodes: ["ERR"] }
  },
  frontend: {
    apiPattern: "invoke_wrapper+typed_meta",
    stateManagement: "local",
    validation: "simple"
  }
};

const baseDelivery = {
  version: "v1",
  verifyPolicy: {
    levelDefault: "full",
    gates: ["pnpm_build", "cargo_check"]
  },
  preflight: {
    checks: [{ id: "node", description: "node", required: true }]
  },
  assets: {
    icons: {
      required: true,
      paths: ["src-tauri/icons/icon.png"]
    }
  }
};

const writeArtifacts = async (
  root: string,
  overrides?: {
    contract?: Record<string, unknown>;
    ux?: Record<string, unknown>;
    implementation?: Record<string, unknown>;
    delivery?: Record<string, unknown>;
  }
): Promise<void> => {
  await mkdir(join(root, "src/lib/design"), { recursive: true });
  await writeFile(join(root, "forgetauri.contract.json"), JSON.stringify(overrides?.contract ?? baseContract, null, 2), "utf8");
  await writeFile(join(root, "src/lib/design/ux.json"), JSON.stringify(overrides?.ux ?? baseUx, null, 2), "utf8");
  await writeFile(
    join(root, "src/lib/design/implementation.json"),
    JSON.stringify(overrides?.implementation ?? baseImplementation, null, 2),
    "utf8"
  );
  await writeFile(join(root, "src/lib/design/delivery.json"), JSON.stringify(overrides?.delivery ?? baseDelivery, null, 2), "utf8");
};

describe("tool_validate_design", () => {
  test("passes when design artifacts are consistent", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-validate-"));
    await writeArtifacts(root);

    const result = await runValidateDesign({ projectRoot: root });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("fails when ux references unknown command", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-validate-"));
    const badUx = {
      ...baseUx,
      screens: [
        {
          ...baseUx.screens[0],
          actions: [{ label: "Lint", command: "missing_cmd" }]
        }
      ]
    };
    await writeArtifacts(root, { ux: badUx });

    const result = await runValidateDesign({ projectRoot: root });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === "UX_UNKNOWN_COMMAND")).toBe(true);
  });

  test("fails when implementation references unknown table", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-validate-"));
    const badImpl = {
      ...baseImplementation,
      rust: {
        ...baseImplementation.rust,
        services: [{ ...baseImplementation.rust.services[0], usesTables: ["missing_table"] }]
      }
    };
    await writeArtifacts(root, { implementation: badImpl });

    const result = await runValidateDesign({ projectRoot: root });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === "IMPL_UNKNOWN_TABLE")).toBe(true);
  });

  test("fails when delivery contains unsupported gate", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-validate-"));

    const result = await toolPackage.runtime.run(
      {
        projectRoot: root,
        contract: baseContract,
        ux: baseUx,
        implementation: baseImplementation,
        delivery: {
          ...baseDelivery,
          verifyPolicy: {
            ...baseDelivery.verifyPolicy,
            gates: ["pnpm_build", "nope_gate"]
          }
        }
      },
      {
        provider: new MockProvider([]),
        runCmdImpl: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }),
        flags: { apply: true, verify: true, repair: true, maxPatchesPerTurn: 8 },
        memory: { patchPaths: [], touchedPaths: [] }
      }
    );

    expect(result.ok).toBe(true);
    const data = result.data as { ok: boolean; errors: Array<{ code: string }> };
    expect(data.ok).toBe(false);
    expect(data.errors.some((error) => error.code === "DELIVERY_UNKNOWN_GATE")).toBe(true);
  });
});
