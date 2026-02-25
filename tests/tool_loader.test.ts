import { describe, expect, test } from "vitest";
import { buildToolDocPack, loadToolPackages } from "../src/agent/tools/loader.js";

describe("tool discovery", () => {
  test("loads tool packages and docs from tool directories", async () => {
    const registry = await loadToolPackages();
    const names = Object.keys(registry).sort((a, b) => a.localeCompare(b));

    expect(names).toEqual([
      "tool_bootstrap_project",
      "tool_codegen_from_design",
      "tool_design_contract",
      "tool_design_delivery",
      "tool_design_implementation",
      "tool_design_ux",
      "tool_materialize_contract",
      "tool_materialize_delivery",
      "tool_materialize_implementation",
      "tool_materialize_ux",
      "tool_read_files",
      "tool_repair_once",
      "tool_run_cmd",
      "tool_validate_design",
      "tool_verify_project"
    ]);

    names.forEach((name) => {
      expect(registry[name]?.docs.length).toBeGreaterThan(0);
      expect(registry[name]?.inputJsonSchema).toBeTruthy();
    });

    const docs = buildToolDocPack(registry);
    expect(docs).toHaveLength(15);
    expect(docs[0]?.name).toBe("tool_bootstrap_project");
  });
});
