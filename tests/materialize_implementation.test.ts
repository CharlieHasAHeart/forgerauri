import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runMaterializeImplementation } from "../src/agent/tools/materialize_implementation/index.js";
import type { ImplementationDesignV1 } from "../src/agent/design/implementation/schema.js";

const impl: ImplementationDesignV1 = {
  version: "v1",
  rust: {
    layering: "commands_service_repo",
    services: [{ name: "lint_service", responsibilities: ["run lint"], usesTables: ["lint_runs"] }],
    repos: [{ name: "lint_repo", table: "lint_runs", operations: ["insert"] }],
    errorModel: { pattern: "thiserror+ApiResponse", errorCodes: ["LINT_FAILED"] }
  },
  frontend: { apiPattern: "invoke_wrapper+typed_meta", stateManagement: "local", validation: "simple" }
};

describe("tool_materialize_implementation", () => {
  test("apply=false returns paths without writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-impl-"));
    const result = await runMaterializeImplementation({ impl, projectRoot: root, apply: false });
    expect(result.summary.wrote).toBe(0);
    expect(existsSync(result.implPath)).toBe(false);
  });

  test("apply=true writes implementation files", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-impl-"));
    const result = await runMaterializeImplementation({ impl, projectRoot: root, apply: true });
    const tsPath = join(root, "src/lib/design/implementation.ts");

    expect(existsSync(result.implPath)).toBe(true);
    expect(existsSync(tsPath)).toBe(true);
    expect(await readFile(tsPath, "utf8")).toContain("implementationDesign");
  });
});
