import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { evaluateAcceptance } from "../src/agent/core/acceptance_engine.js";
import { requirementKey } from "../src/agent/core/requirement.js";
import { createSnapshot } from "../src/agent/core/workspace_snapshot.js";

describe("acceptance engine monotonicity", () => {
  test("requirements do not shrink with unrelated evidence; shrink only when snapshot satisfies", async () => {
    const root = join(tmpdir(), `forgetauri-acc-mono-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "a.txt"), "A", "utf8");

    const intent = { type: "ensure_paths" as const, expected_paths: ["a.txt", "b.txt"] };

    const snapshot1 = await createSnapshot(root, { paths: intent.expected_paths });
    const first = evaluateAcceptance({
      goal: "mono",
      intent,
      evidence: [],
      snapshot: snapshot1
    });

    expect(first.status).toBe("pending");
    const firstKeys = first.requirements.map((requirement) => requirementKey(requirement));

    const second = evaluateAcceptance({
      goal: "mono",
      intent,
      evidence: [
        {
          event_type: "tool_called",
          run_id: "r1",
          turn: 1,
          task_id: "t1",
          call_id: "c1",
          tool_name: "tool_read_files",
          input: {},
          started_at: new Date().toISOString()
        },
        {
          event_type: "tool_returned",
          run_id: "r1",
          turn: 1,
          task_id: "t1",
          call_id: "c1",
          tool_name: "tool_read_files",
          ok: true,
          ended_at: new Date().toISOString()
        }
      ],
      snapshot: snapshot1
    });

    const secondKeys = second.requirements.map((requirement) => requirementKey(requirement));
    expect(second.status).toBe("pending");
    expect(secondKeys).toEqual(firstKeys);

    await writeFile(join(root, "b.txt"), "B", "utf8");
    const snapshot2 = await createSnapshot(root, { paths: intent.expected_paths });
    const third = evaluateAcceptance({
      goal: "mono",
      intent,
      evidence: [
        {
          event_type: "tool_returned",
          run_id: "r1",
          turn: 2,
          task_id: "t1",
          call_id: "c2",
          tool_name: "tool_materialize_ux",
          ok: true,
          ended_at: new Date().toISOString()
        }
      ],
      snapshot: snapshot2
    });

    expect(third.status).toBe("satisfied");
    expect(third.requirements).toEqual([]);
    expect(third.satisfied_requirements.map((requirement) => requirementKey(requirement)).sort()).toEqual(
      ["file_exists:a.txt", "file_exists:b.txt"].sort()
    );
  });
});

