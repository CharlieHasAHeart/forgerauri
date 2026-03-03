import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { describe, expect, test } from "vitest";
import { executeToolCall } from "../src/agent/runtime/executor.js";
import { defaultAgentPolicy } from "../src/agent/runtime/policy/policy.js";
import type { AgentState } from "../src/agent/types.js";
import type { ToolRunContext, ToolSpec } from "../src/agent/tools/types.js";
import { MockProvider } from "./helpers/mockProvider.js";

const makeState = (outDir: string): AgentState => ({
  status: "executing",
  goal: "verify gate",
  specPath: "/tmp/spec.json",
  outDir,
  flags: { apply: true, verify: true, repair: false, truncation: "auto" },
  usedLLM: false,
  verifyHistory: [],
  budgets: { maxTurns: 8, maxPatches: 6, usedTurns: 1, usedPatches: 0, usedRepairs: 0 },
  patchPaths: [],
  humanReviews: [],
  touchedFiles: [],
  toolCalls: [],
  toolResults: []
});

const makeCommandRanLine = (args: { idx: number; cmd: string; argv: string[]; cwd: string }): string =>
  JSON.stringify({
    event_type: "command_ran",
    run_id: "run-verify-gate",
    turn: 1,
    task_id: "t_verify",
    call_id: `c-${args.idx}`,
    cmd: args.cmd,
    args: args.argv,
    cwd: args.cwd,
    ok: true,
    exit_code: 0,
    at: new Date().toISOString()
  });

describe("tool_verify_project acceptance gate", () => {
  test("fails executeToolCall when acceptance pipeline is not satisfied", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "forgetauri-verify-gate-"));
    const appDir = join(outDir, "generated", "app").replace(/\\/g, "/");
    const tauriDir = `${appDir}/src-tauri`;
    const evidenceFilePath = join(outDir, "run_evidence.jsonl");

    await writeFile(
      evidenceFilePath,
      [
        makeCommandRanLine({ idx: 1, cmd: "pnpm", argv: ["install"], cwd: appDir }),
        makeCommandRanLine({ idx: 2, cmd: "pnpm", argv: ["build"], cwd: appDir }),
        makeCommandRanLine({ idx: 3, cmd: "cargo", argv: ["check"], cwd: tauriDir }),
        makeCommandRanLine({ idx: 4, cmd: "pnpm", argv: ["tauri", "--help"], cwd: appDir })
      ].join("\n"),
      "utf8"
    );

    const state = makeState(outDir);
    state.runtimePaths = {
      repoRoot: outDir.replace(/\\/g, "/"),
      appDir,
      tauriDir
    };

    const ctx: ToolRunContext = {
      provider: new MockProvider([]),
      runCmdImpl: async () => ({ ok: true, code: 0, stdout: "", stderr: "", cmd: "", args: [], cwd: outDir }),
      flags: { apply: true, verify: true, repair: false, maxPatchesPerTurn: 8 },
      memory: {
        outDir,
        patchPaths: [],
        touchedPaths: [],
        runtimePaths: state.runtimePaths
      }
    };

    const registry: Record<string, ToolSpec<any>> = {
      tool_verify_project: {
        name: "tool_verify_project",
        description: "verify",
        inputSchema: z.object({ projectRoot: z.string() }),
        inputJsonSchema: {},
        category: "high",
        capabilities: [],
        safety: { sideEffects: "exec" },
        docs: "",
        run: async () => ({ ok: true, data: { ok: true }, meta: { touchedPaths: [appDir] } }),
        examples: []
      }
    };
    const policy = defaultAgentPolicy({
      maxSteps: 8,
      maxActionsPerTask: 4,
      maxRetriesPerTask: 2,
      maxReplans: 2,
      allowedTools: ["tool_verify_project"]
    });

    const result = await executeToolCall({
      call: { name: "tool_verify_project", input: { projectRoot: appDir } },
      registry,
      ctx,
      state,
      policy
    });

    expect(result.ok).toBe(false);
    expect(state.lastError?.code).toBe("VERIFY_ACCEPTANCE_FAILED");
    expect(state.lastError?.message ?? "").toContain("VERIFY_ACCEPTANCE_FAILED");
  });
});
