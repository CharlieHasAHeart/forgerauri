import { describe, expect, test } from "vitest";
import { evaluateAcceptance } from "../src/agent/core/acceptance/engine.js";
import { createSnapshot } from "../src/agent/core/workspace/snapshot.js";

const event = (args: {
  idx: number;
  commandId: string;
  cmd: string;
  argv: string[];
  cwd: string;
}) => ({
  event_type: "command_ran" as const,
  run_id: "run-command-id",
  turn: 1,
  task_id: "t_verify",
  call_id: `c-${args.idx}`,
  command_id: args.commandId,
  cmd: args.cmd,
  args: args.argv,
  cwd: args.cwd,
  ok: true,
  exit_code: 0,
  at: new Date().toISOString()
});

describe("acceptance prefers command_id matching", () => {
  test("satisfies pipeline when command_id is present and command payload matches", async () => {
    const repoRoot = "/tmp/repo";
    const appDir = "/tmp/repo/generated/app";
    const tauriDir = "/tmp/repo/generated/app/src-tauri";
    const snapshot = await createSnapshot(process.cwd(), { paths: [] });
    const evidence = [
      event({ idx: 1, commandId: "pnpm_install", cmd: "pnpm", argv: ["install"], cwd: appDir }),
      event({ idx: 2, commandId: "pnpm_build", cmd: "pnpm", argv: ["build"], cwd: appDir }),
      event({ idx: 3, commandId: "cargo_check", cmd: "cargo", argv: ["check"], cwd: tauriDir }),
      event({ idx: 4, commandId: "pnpm_tauri_help", cmd: "pnpm", argv: ["tauri", "--help"], cwd: appDir }),
      event({ idx: 5, commandId: "pnpm_tauri_build", cmd: "pnpm", argv: ["tauri", "build"], cwd: appDir })
    ];

    const result = evaluateAcceptance({
      goal: "verify",
      intent: { type: "verify_acceptance_pipeline", pipeline_id: "desktop_tauri_default" },
      evidence,
      snapshot,
      runtime: { repoRoot, appDir, tauriDir }
    });

    expect(result.status).toBe("satisfied");
  });
});
