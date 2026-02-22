import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { invokeGraph } from "../src/workflow/graph.js";
import { createInitialState } from "../src/workflow/state.js";

const writeSpec = async (dir: string): Promise<string> => {
  const spec = {
    app: { name: "Workflow Demo", one_liner: "demo" },
    screens: [{ name: "Home", purpose: "Home screen", primary_actions: [] }],
    rust_commands: [{ name: "ping_like", async: true, input: {}, output: {} }],
    data_model: { tables: [] },
    acceptance_tests: [],
    mvp_plan: []
  };

  const path = join(dir, "spec.json");
  await writeFile(path, JSON.stringify(spec, null, 2), "utf8");
  return path;
};

describe("workflow graph", () => {
  test("plan mode runs load_spec/build_plan and skips apply/verify", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-workflow-"));
    const specPath = await writeSpec(root);
    const outDir = join(root, "generated");

    const initial = createInitialState({
      specPath,
      outDir,
      flags: {
        plan: true,
        apply: false,
        llmEnrich: false,
        verify: false,
        repair: false
      }
    });

    const result = await invokeGraph(initial);

    expect(result.planSummary).not.toBeNull();
    expect(result.audit.some((item) => item.node === "load_spec")).toBe(true);
    expect(result.audit.some((item) => item.node === "build_plan")).toBe(true);
    expect(result.applySummary).toBeNull();
    expect(result.verifyResult).toBeNull();
  });

  test("apply disabled keeps verify branch from executing", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-workflow-"));
    const specPath = await writeSpec(root);
    const outDir = join(root, "generated");

    const initial = createInitialState({
      specPath,
      outDir,
      flags: {
        plan: false,
        apply: false,
        llmEnrich: false,
        verify: true,
        repair: true
      }
    });

    const result = await invokeGraph(initial);

    expect(result.planSummary).not.toBeNull();
    expect(result.audit.some((item) => item.node === "verify")).toBe(false);
    expect(result.audit.some((item) => item.node === "repair")).toBe(false);
    expect(result.verifyResult).toBeNull();
    expect(result.repairResult).toBeNull();
  });
});
