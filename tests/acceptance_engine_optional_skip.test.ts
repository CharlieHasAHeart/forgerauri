import { describe, expect, test } from "vitest";
import { evaluateAcceptance } from "../src/agent/core/acceptance/engine.js";
import { createSnapshot } from "../src/agent/core/workspace/snapshot.js";

const commandRan = (args: { idx: number; cmd: string; argv: string[]; cwd: string }) => ({
  event_type: "command_ran" as const,
  run_id: "run-opt-skip",
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

const skipped = (commandId: string, reason: "precheck_skip_if_exists" | "precheck_skip_if_cmd_ran_ok") => ({
  event_type: "acceptance_step_skipped" as const,
  run_id: "run-opt-skip",
  turn: 1,
  task_id: "t_verify",
  step_id: `desktop_tauri_default:${commandId}`,
  pipeline_id: "desktop_tauri_default",
  command_id: commandId,
  reason,
  at: new Date().toISOString()
});

describe("acceptance engine optional skip", () => {
  test("optional step skipped still satisfies pipeline and reports reason", async () => {
    const appDir = "/tmp/repo/generated/app";
    const tauriDir = "/tmp/repo/generated/app/src-tauri";
    const snapshot = await createSnapshot(process.cwd(), { paths: [] });
    const evidence = [
      skipped("pnpm_install", "precheck_skip_if_exists"),
      commandRan({ idx: 2, cmd: "pnpm", argv: ["build"], cwd: appDir }),
      commandRan({ idx: 3, cmd: "cargo", argv: ["check"], cwd: tauriDir }),
      commandRan({ idx: 4, cmd: "pnpm", argv: ["tauri", "--help"], cwd: appDir }),
      commandRan({ idx: 5, cmd: "pnpm", argv: ["tauri", "build"], cwd: appDir })
    ];

    const result = evaluateAcceptance({
      goal: "verify",
      intent: { type: "verify_acceptance_pipeline", pipeline_id: "desktop_tauri_default" },
      evidence,
      snapshot,
      runtime: { repoRoot: "/tmp/repo", appDir, tauriDir }
    });

    expect(result.status).toBe("satisfied");
    expect(result.requirements).toEqual([]);
    expect(result.diagnostics.some((item) => item.includes("optional step skipped: pnpm_install"))).toBe(true);
  });
});
