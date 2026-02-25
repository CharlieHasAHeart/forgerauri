import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runMaterializeDelivery } from "../src/agent/tools/materialize_delivery/index.js";
import type { DeliveryDesignV1 } from "../src/agent/design/delivery/schema.js";

const delivery: DeliveryDesignV1 = {
  version: "v1",
  verifyPolicy: {
    levelDefault: "full",
    gates: ["pnpm_install_if_needed", "pnpm_build", "cargo_check", "tauri_help"],
    smokeCommands: ["lint_config"]
  },
  preflight: {
    checks: [{ id: "node", description: "Node installed", cmd: "node --version", required: true }]
  },
  assets: {
    icons: { required: true, paths: ["src-tauri/icons/icon.png"] }
  }
};

describe("tool_materialize_delivery", () => {
  test("apply=false returns paths without writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-delivery-"));
    const result = await runMaterializeDelivery({ delivery, projectRoot: root, apply: false });
    expect(result.summary.wrote).toBe(0);
    expect(existsSync(result.deliveryPath)).toBe(false);
  });

  test("apply=true writes delivery files and placeholder icon when required", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-delivery-"));
    const result = await runMaterializeDelivery({ delivery, projectRoot: root, apply: true });

    const deliveryTsPath = join(root, "src/lib/design/delivery.ts");
    const iconPath = join(root, "src-tauri/icons/icon.png");

    expect(existsSync(result.deliveryPath)).toBe(true);
    expect(existsSync(deliveryTsPath)).toBe(true);
    expect(existsSync(iconPath)).toBe(true);

    const content = await readFile(result.deliveryPath, "utf8");
    expect(content).toContain("verifyPolicy");
  });
});
