import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { evaluateAcceptance } from "../src/agent/core/acceptance_engine.js";
import { createSnapshot } from "../src/agent/core/workspace_snapshot.js";

describe("acceptance engine - bootstrap intent", () => {
  test("satisfied when all fingerprints exist", async () => {
    const root = join(tmpdir(), `forgetauri-acc-bootstrap-a-${Date.now()}`);
    await mkdir(join(root, "src-tauri"), { recursive: true });
    await writeFile(join(root, "package.json"), "{}", "utf8");
    await writeFile(join(root, "src-tauri/Cargo.toml"), "[package]\nname='x'", "utf8");

    const snapshot = await createSnapshot(root, { paths: ["package.json", "src-tauri/Cargo.toml"] });
    const result = evaluateAcceptance({
      goal: "bootstrap",
      intent: { type: "bootstrap", fingerprints: ["package.json", "src-tauri/Cargo.toml"] },
      evidence: [],
      snapshot
    });

    expect(result.status).toBe("satisfied");
    expect(result.requirements).toEqual([]);
    expect(result.satisfied_requirements).toHaveLength(2);
  });

  test("pending with missing fingerprint requirement", async () => {
    const root = join(tmpdir(), `forgetauri-acc-bootstrap-b-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "package.json"), "{}", "utf8");

    const snapshot = await createSnapshot(root, { paths: ["package.json", "src-tauri/Cargo.toml"] });
    const result = evaluateAcceptance({
      goal: "bootstrap",
      intent: { type: "bootstrap", fingerprints: ["package.json", "src-tauri/Cargo.toml"] },
      evidence: [],
      snapshot
    });

    expect(result.status).toBe("pending");
    expect(result.requirements).toEqual([{ kind: "file_exists", path: "src-tauri/Cargo.toml" }]);
  });
});

