import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { runRepairKnownIssues } from "../src/agent/tools/core/repair_known_issues/index.js";

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const minimalConf = (iconPaths: string[] = ["icons/icon.png"]): Record<string, unknown> => ({
  $schema: "https://schema.tauri.app/config/2",
  productName: "Demo",
  version: "0.1.0",
  identifier: "com.forgetauri.demo",
  build: {
    beforeDevCommand: "pnpm dev",
    beforeBuildCommand: "pnpm build",
    devUrl: "http://localhost:1420",
    frontendDist: "../dist"
  },
  app: {
    windows: [{ title: "Demo", width: 900, height: 640 }]
  },
  bundle: {
    active: false,
    targets: "all",
    icon: iconPaths
  }
});

describe("tool_repair_known_issues", () => {
  test("creates missing icon when tauri config points to icons/icon.png", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-known-repair-"));
    const confPath = join(root, "src-tauri/tauri.conf.json");
    await mkdir(join(root, "src-tauri"), { recursive: true });
    await writeJson(confPath, minimalConf(["icons/icon.png"]));

    const result = await runRepairKnownIssues({ projectRoot: root });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.fixes.some((fix) => fix.id === "ensure_icon_png")).toBe(true);
  });

  test("normalizes broken bundle.icon path and creates fallback icon", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-known-repair-"));
    const confPath = join(root, "src-tauri/tauri.conf.json");
    await mkdir(join(root, "src-tauri"), { recursive: true });
    await writeJson(confPath, minimalConf(["missing.png"]));

    const result = await runRepairKnownIssues({ projectRoot: root });
    const confRaw = await readFile(confPath, "utf8");

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.fixes.some((fix) => fix.id === "normalize_icon_paths")).toBe(true);
    expect(confRaw).toContain('"icons/icon.png"');
  });

  test("returns changed=false when no known issues exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-known-repair-"));
    const confPath = join(root, "src-tauri/tauri.conf.json");
    const capPath = join(root, "src-tauri/capabilities/default.json");
    const iconPath = join(root, "src-tauri/icons/icon.png");

    await mkdir(join(root, "src-tauri/icons"), { recursive: true });
    await mkdir(join(root, "src-tauri/capabilities"), { recursive: true });
    await writeJson(confPath, minimalConf(["icons/icon.png"]));
    await writeJson(capPath, {
      $schema: "../gen/schemas/desktop-schema.json",
      identifier: "default",
      description: "Default capability",
      windows: ["main"],
      permissions: ["core:default"]
    });
    await writeFile(iconPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64"));

    const first = await runRepairKnownIssues({ projectRoot: root });
    const second = await runRepairKnownIssues({ projectRoot: root });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.fixes).toEqual([]);
  });

  test("creates missing capabilities default file", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-known-repair-"));
    const confPath = join(root, "src-tauri/tauri.conf.json");

    await mkdir(join(root, "src-tauri"), { recursive: true });
    await writeJson(confPath, minimalConf());

    const result = await runRepairKnownIssues({ projectRoot: root });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.fixes.some((fix) => fix.id === "ensure_capabilities_default")).toBe(true);
  });
});
