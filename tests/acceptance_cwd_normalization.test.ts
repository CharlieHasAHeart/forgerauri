import { describe, expect, test } from "vitest";
import { evaluateAcceptance } from "../src/agent/core/acceptance_engine.js";
import { createSnapshot } from "../src/agent/core/workspace_snapshot.js";

const makeCommandRan = (args: { cmd: string; argv: string[]; cwd: string; idx: number }) => ({
  event_type: "command_ran" as const,
  run_id: "run-cwd-norm",
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

describe("acceptance cwd normalization", () => {
  test("matches relative evidence cwd against absolute runtime paths", async () => {
    const runtime = {
      repoRoot: "/tmp/repo",
      appDir: "/tmp/repo/generated/app",
      tauriDir: "/tmp/repo/generated/app/src-tauri"
    };
    const evidence = [
      makeCommandRan({ idx: 1, cmd: "pnpm", argv: ["install"], cwd: "./generated/app" }),
      makeCommandRan({ idx: 2, cmd: "pnpm", argv: ["build"], cwd: "./generated/app" }),
      makeCommandRan({ idx: 3, cmd: "cargo", argv: ["check"], cwd: "./generated/app/src-tauri" }),
      makeCommandRan({ idx: 4, cmd: "pnpm", argv: ["tauri", "--help"], cwd: "./generated/app" }),
      makeCommandRan({ idx: 5, cmd: "pnpm", argv: ["tauri", "build"], cwd: "./generated/app" })
    ];
    const snapshot = await createSnapshot(process.cwd(), { paths: [] });

    const result = evaluateAcceptance({
      goal: "verify pipeline",
      intent: { type: "verify_acceptance_pipeline", pipeline_id: "desktop_tauri_default" },
      evidence,
      snapshot,
      runtime
    });

    expect(result.status).toBe("satisfied");
    expect(result.requirements).toEqual([]);
    expect(result.satisfied_requirements).toHaveLength(5);
  });
});
