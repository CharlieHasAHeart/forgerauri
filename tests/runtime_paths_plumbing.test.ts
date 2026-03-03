import { describe, expect, test } from "vitest";
import { createSnapshot } from "../src/agent/core/workspace/snapshot.js";
import { evaluateAcceptanceRuntime } from "../src/agent/runtime/evaluate_acceptance_runtime.js";
import { getRuntimePaths } from "../src/agent/runtime/get_runtime_paths.js";
import type { ToolRunContext } from "../src/agent/tools/types.js";
import type { AgentState } from "../src/agent/types.js";

const makeCommandRan = (args: { cmd: string; argv: string[]; cwd: string; idx: number }) => ({
  event_type: "command_ran" as const,
  run_id: "run-runtime-paths",
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

describe("runtime paths plumbing", () => {
  test("getRuntimePaths resolves from state/ctx and evaluateAcceptanceRuntime consumes them", async () => {
    const appDir = "/tmp/generated/app";
    const tauriDir = "/tmp/generated/app/src-tauri";

    const ctx = {
      provider: {} as ToolRunContext["provider"],
      runCmdImpl: async () => ({ ok: true, code: 0, stdout: "", stderr: "" }),
      flags: { apply: true, verify: true, repair: true, maxPatchesPerTurn: 8 },
      memory: {
        outDir: "/tmp/generated",
        appDir,
        patchPaths: [],
        touchedPaths: []
      }
    } as ToolRunContext;

    const state = {
      status: "planning",
      goal: "verify pipeline",
      specPath: "/tmp/spec.json",
      outDir: "/tmp/generated",
      flags: { apply: true, verify: true, repair: true, truncation: "auto" as const },
      usedLLM: false,
      verifyHistory: [],
      budgets: { maxTurns: 8, maxPatches: 8, usedTurns: 0, usedPatches: 0, usedRepairs: 0 },
      patchPaths: [],
      humanReviews: [],
      touchedFiles: [],
      toolCalls: [],
      toolResults: []
    } as AgentState;

    const runtime = getRuntimePaths(ctx, state);
    expect(runtime.appDir).toBe(appDir);
    expect(runtime.tauriDir).toBe(tauriDir);

    ctx.memory.runtimePaths = runtime;
    state.runtimePaths = runtime;

    const evidence = [
      makeCommandRan({ idx: 1, cmd: "pnpm", argv: ["install"], cwd: appDir }),
      makeCommandRan({ idx: 2, cmd: "pnpm", argv: ["build"], cwd: appDir }),
      makeCommandRan({ idx: 3, cmd: "cargo", argv: ["check"], cwd: tauriDir }),
      makeCommandRan({ idx: 4, cmd: "pnpm", argv: ["tauri", "--help"], cwd: appDir }),
      makeCommandRan({ idx: 5, cmd: "pnpm", argv: ["tauri", "build"], cwd: appDir })
    ];
    const snapshot = await createSnapshot(process.cwd(), { paths: [] });

    const result = evaluateAcceptanceRuntime({
      goal: "verify desktop app",
      intent: { type: "verify_acceptance_pipeline", pipeline_id: "desktop_tauri_default" },
      ctx,
      state,
      evidence,
      snapshot
    });

    expect(result.status).toBe("satisfied");
    expect(result.requirements).toEqual([]);
    expect(result.satisfied_requirements).toHaveLength(5);
  });
});
