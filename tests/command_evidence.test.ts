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
  goal: "test-command-evidence",
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
    evidenceRunId: "run-command-1",
    evidenceTurn: 2,
    evidenceTaskId: "t_cmd",
    evidenceLogger: logger
  }
});

const makeRegistry = (success: boolean): Record<string, ToolSpec<any>> => ({
  tool_run_cmd: {
    name: "tool_run_cmd",
    description: "run command",
    inputSchema: z.object({ cwd: z.string(), cmd: z.string(), args: z.array(z.string()) }),
    inputJsonSchema: {},
    category: "low",
    capabilities: [],
    safety: { sideEffects: "exec", allowlist: ["pnpm", "node", "cargo", "tauri"] },
    docs: "",
    run: async (input) => ({
      ok: success,
      data: {
        ok: success,
        code: success ? 0 : 1,
        stdout: "X".repeat(10000),
        stderr: success ? "" : "ERR: command failed"
      },
      error: success ? undefined : { code: "CMD_FAIL", message: "failed" },
      meta: { touchedPaths: [input.cwd] }
    }),
    examples: []
  }
});

describe("command evidence", () => {
  test("writes command_ran with tail output and tool_returned exit_code (success)", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-command-evidence-a-"));
    const filePath = join(root, "run_evidence.jsonl");
    const logger = new EvidenceLogger({ filePath });
    const state = makeState(root);
    const ctx = makeCtx(root, logger);
    const registry = makeRegistry(true);
    const policy = defaultAgentPolicy({
      maxSteps: 8,
      maxActionsPerTask: 4,
      maxRetriesPerTask: 2,
      maxReplans: 2,
      allowedTools: ["tool_run_cmd"]
    });

    await executeToolCall({
      call: { name: "tool_run_cmd", input: { cwd: "./generated/app", cmd: "pnpm", args: ["test"] } },
      registry,
      ctx,
      state,
      policy
    });
    await logger.close();

    const lines = (await readFile(filePath, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const called = events.find((e) => e.event_type === "tool_called");
    const returned = events.find((e) => e.event_type === "tool_returned");
    const cmdRan = events.find((e) => e.event_type === "command_ran");

    expect(called).toBeTruthy();
    expect(returned?.exit_code).toBe(0);
    expect(cmdRan?.cmd).toBe("pnpm");
    expect(cmdRan?.args).toEqual(["test"]);
    expect(String(cmdRan?.cwd ?? "").endsWith("/generated/app")).toBe(true);
    expect(cmdRan?.exit_code).toBe(0);
    const stdoutTail = String(cmdRan?.stdout_tail ?? "");
    expect(stdoutTail.length).toBeLessThanOrEqual(4000 + "...<truncated>".length);
    expect(stdoutTail.endsWith("X")).toBe(true);
  });

  test("writes command_ran and tool_returned exit_code on failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgetauri-command-evidence-b-"));
    const filePath = join(root, "run_evidence.jsonl");
    const logger = new EvidenceLogger({ filePath });
    const state = makeState(root);
    const ctx = makeCtx(root, logger);
    const registry = makeRegistry(false);
    const policy = defaultAgentPolicy({
      maxSteps: 8,
      maxActionsPerTask: 4,
      maxRetriesPerTask: 2,
      maxReplans: 2,
      allowedTools: ["tool_run_cmd"]
    });

    await executeToolCall({
      call: { name: "tool_run_cmd", input: { cwd: "./generated/app", cmd: "pnpm", args: ["build"] } },
      registry,
      ctx,
      state,
      policy
    });
    await logger.close();

    const lines = (await readFile(filePath, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const returned = events.find((e) => e.event_type === "tool_returned");
    const cmdRan = events.find((e) => e.event_type === "command_ran");

    expect(returned?.exit_code).toBe(1);
    expect(cmdRan?.ok).toBe(false);
    expect(cmdRan?.exit_code).toBe(1);
    expect(String(cmdRan?.stderr_tail ?? "")).toContain("ERR");
  });
});
