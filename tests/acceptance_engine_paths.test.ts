import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { evaluateAcceptance } from "../src/agent/core/acceptance_engine.js";
import { createSnapshot } from "../src/agent/core/workspace_snapshot.js";

describe("acceptance engine - ensure_paths intent", () => {
  test("pending when one expected path is missing", async () => {
    const root = join(tmpdir(), `forgetauri-acc-paths-a-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "a.txt"), "A", "utf8");

    const snapshot = await createSnapshot(root, { paths: ["a.txt", "b.txt"] });
    const result = evaluateAcceptance({
      goal: "ensure",
      intent: { type: "ensure_paths", expected_paths: ["a.txt", "b.txt"] },
      evidence: [],
      snapshot
    });

    expect(result.status).toBe("pending");
    expect(result.requirements).toEqual([{ kind: "file_exists", path: "b.txt" }]);
  });

  test("satisfied when all expected paths exist", async () => {
    const root = join(tmpdir(), `forgetauri-acc-paths-b-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "a.txt"), "A", "utf8");
    await writeFile(join(root, "b.txt"), "B", "utf8");

    const snapshot = await createSnapshot(root, { paths: ["a.txt", "b.txt"] });
    const result = evaluateAcceptance({
      goal: "ensure",
      intent: { type: "ensure_paths", expected_paths: ["a.txt", "b.txt"] },
      evidence: [],
      snapshot
    });

    expect(result.status).toBe("satisfied");
    expect(result.requirements).toEqual([]);
    expect(result.satisfied_requirements).toHaveLength(2);
  });
});

