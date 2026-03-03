import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { EvidenceLogger } from "../src/agent/core/evidence_logger.js";
import type { EvidenceEvent } from "../src/agent/core/evidence.js";

describe("evidence logger", () => {
  test("writes parseable jsonl lines in append order", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-evidence-"));
    const filePath = join(root, "run_evidence.jsonl");
    const logger = new EvidenceLogger({ filePath });

    const e1: EvidenceEvent = {
      event_type: "tool_called",
      run_id: "run-1",
      turn: 1,
      task_id: "t1",
      call_id: "c1",
      tool_name: "tool_a",
      input: { a: 1 },
      started_at: new Date().toISOString()
    };
    const e2: EvidenceEvent = {
      event_type: "tool_returned",
      run_id: "run-1",
      turn: 1,
      task_id: "t1",
      call_id: "c1",
      tool_name: "tool_a",
      ok: true,
      ended_at: new Date().toISOString(),
      touched_paths: ["a.txt"]
    };

    logger.append(e1);
    logger.append(e2);
    await logger.close();

    const lines = (await readFile(filePath, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(2);

    const parsed = lines.map((line) => JSON.parse(line) as EvidenceEvent);
    expect(parsed[0]).toMatchObject({ event_type: "tool_called", call_id: "c1", tool_name: "tool_a" });
    expect(parsed[1]).toMatchObject({ event_type: "tool_returned", call_id: "c1", ok: true });
  });
});

