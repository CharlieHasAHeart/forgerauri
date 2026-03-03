import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { describe, expect, test } from "vitest";
import { EvidenceLogger } from "../src/agent/core/evidence_logger.js";
import { executeToolCall } from "../src/agent/runtime/executor.js";
import { defaultAgentPolicy } from "../src/agent/policy/policy.js";
import type { AgentState } from "../src/agent/types.js";
import type { ToolRunContext, ToolSpec } from "../src/agent/tools/types.js";
import { MockProvider } from "./helpers/mockProvider.js";

const makeState = (outDir: string): AgentState => ({
  status: "executing",
  goal: "test",
  specPath: "/tmp/spec.json",
  outDir,
  flags: { apply: true, verify: false, repair: false, truncation: "auto" },
  usedLLM: false,
  verifyHistory: [],
  budgets: { maxTurns: 8, maxPatches: 6, usedTurns: 1, usedPatches: 0, usedRepairs: 0 },
  patchPaths: [],
  humanReviews: [],
  touchedFiles: [],
  toolCalls: [],
  toolResults: []
});

const makeCtx = (outDir: string, logger: EvidenceLogger): ToolRunContext => ({
  provider: new MockProvider([]),
  runCmdImpl: async () => ({ ok: true, code: 0, stdout: "", stderr: "", cmd: "", args: [], cwd: outDir }),
  flags: { apply: true, verify: false, repair: false, maxPatchesPerTurn: 8 },
  memory: {
    specPath: "/tmp/spec.json",
    outDir,
    patchPaths: [],
    touchedPaths: [],
    evidenceRunId: "run-test-1",
    evidenceTurn: 1,
    evidenceTaskId: "t1",
    evidenceLogger: logger
  }
});

describe("executor evidence", () => {
  test("emits tool_called + tool_returned for successful and failed tool runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-executor-evidence-"));
    const filePath = join(root, "run_evidence.jsonl");
    const logger = new EvidenceLogger({ filePath });
    const state = makeState(root);
    const ctx = makeCtx(root, logger);

    const registry: Record<string, ToolSpec<any>> = {
      tool_fake: {
        name: "tool_fake",
        description: "fake",
        inputSchema: z.object({ ok: z.boolean() }),
        inputJsonSchema: {},
        category: "low",
        capabilities: [],
        safety: { sideEffects: "none" },
        docs: "",
        run: async (input) =>
          input.ok
            ? { ok: true, data: { done: true }, meta: { touchedPaths: ["a.txt"] } }
            : { ok: false, error: { code: "FAIL", message: "boom" }, data: { done: false }, meta: { touchedPaths: [] } },
        examples: []
      }
    };

    const policy = defaultAgentPolicy({
      maxSteps: 8,
      maxActionsPerTask: 4,
      maxRetriesPerTask: 2,
      maxReplans: 2,
      allowedTools: ["tool_fake"]
    });

    await executeToolCall({ call: { name: "tool_fake", input: { ok: true } }, registry, ctx, state, policy });
    await executeToolCall({ call: { name: "tool_fake", input: { ok: false } }, registry, ctx, state, policy });
    await logger.close();

    const lines = (await readFile(filePath, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(4);
    const events = lines.map((line) => JSON.parse(line) as { event_type: string; ok?: boolean; touched_paths?: string[] });
    expect(events[0]?.event_type).toBe("tool_called");
    expect(events[1]).toMatchObject({ event_type: "tool_returned", ok: true, touched_paths: ["a.txt"] });
    expect(events[2]?.event_type).toBe("tool_called");
    expect(events[3]).toMatchObject({ event_type: "tool_returned", ok: false });
  });

  test("emits tool_returned(ok=false) for policy block, unknown tool, schema failure and thrown tool", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-executor-evidence-"));
    const filePath = join(root, "run_evidence.jsonl");
    const logger = new EvidenceLogger({ filePath });
    const state = makeState(root);
    const ctx = makeCtx(root, logger);

    const registry: Record<string, ToolSpec<any>> = {
      tool_schema: {
        name: "tool_schema",
        description: "schema",
        inputSchema: z.object({ value: z.number() }),
        inputJsonSchema: {},
        category: "low",
        capabilities: [],
        safety: { sideEffects: "none" },
        docs: "",
        run: async () => ({ ok: true, data: {}, meta: { touchedPaths: [] } }),
        examples: []
      },
      tool_throw: {
        name: "tool_throw",
        description: "throw",
        inputSchema: z.object({}).passthrough(),
        inputJsonSchema: {},
        category: "low",
        capabilities: [],
        safety: { sideEffects: "none" },
        docs: "",
        run: async () => {
          throw new Error("boom throw");
        },
        examples: []
      }
    };

    const policy = defaultAgentPolicy({
      maxSteps: 8,
      maxActionsPerTask: 4,
      maxRetriesPerTask: 2,
      maxReplans: 2,
      allowedTools: ["tool_schema", "tool_unknown", "tool_throw"]
    });

    await executeToolCall({ call: { name: "tool_blocked", input: {} }, registry, ctx, state, policy });
    await executeToolCall({ call: { name: "tool_unknown", input: {} }, registry, ctx, state, policy });
    await executeToolCall({ call: { name: "tool_schema", input: { value: "bad" } }, registry, ctx, state, policy });
    await executeToolCall({ call: { name: "tool_throw", input: {} }, registry, ctx, state, policy });
    await logger.close();

    const lines = (await readFile(filePath, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(8);
    const events = lines.map((line) => JSON.parse(line) as { event_type: string; ok?: boolean; note?: string });
    const returned = events.filter((item) => item.event_type === "tool_returned");
    expect(returned).toHaveLength(4);
    expect(returned.every((item) => item.ok === false)).toBe(true);
    expect(returned[0]?.note ?? "").toContain("blocked by policy");
    expect(returned[1]?.note ?? "").toContain("unknown tool");
    expect(returned[2]?.note ?? "").toContain("expected number");
    expect(returned[3]?.note ?? "").toContain("threw");
  });
});
