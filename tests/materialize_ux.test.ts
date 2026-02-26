import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runMaterializeUx } from "../src/agent/tools/core/materialize_ux/index.js";
import type { UXDesignV1 } from "../src/agent/design/ux/schema.js";

const ux: UXDesignV1 = {
  version: "v1",
  navigation: { kind: "sidebar", items: [{ id: "home", title: "Home", route: "/" }] },
  screens: [
    {
      id: "home",
      title: "Home",
      route: "/",
      purpose: "Overview",
      dataNeeds: [{ source: "command", command: "lint_config" }],
      actions: [{ label: "Lint", command: "lint_config" }],
      states: { loading: true, empty: "No data", error: "Error" }
    }
  ]
};

describe("tool_materialize_ux", () => {
  test("apply=false returns paths without writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-ux-"));
    const result = await runMaterializeUx({ ux, projectRoot: root, apply: false });
    expect(result.summary.wrote).toBe(0);
    expect(existsSync(result.uxPath)).toBe(false);
  });

  test("apply=true writes ux.json and ux.ts", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-ux-"));
    const result = await runMaterializeUx({ ux, projectRoot: root, apply: true });

    const tsPath = join(root, "src/lib/design/ux.ts");
    expect(existsSync(result.uxPath)).toBe(true);
    expect(existsSync(tsPath)).toBe(true);

    const ts = await readFile(tsPath, "utf8");
    expect(ts).toContain("export const uxDesign");
  });
});
