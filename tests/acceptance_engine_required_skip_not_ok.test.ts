import { describe, expect, test } from "vitest";
import { evaluateAcceptance } from "../src/agent/core/acceptance/engine.js";
import { createSnapshot } from "../src/agent/core/workspace/snapshot.js";

const commandRan = (args: { idx: number; commandId: string; cmd: string; argv: string[]; cwd: string }) => ({
  event_type: "command_ran" as const,
  run_id: "run-required-skip",
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

describe("acceptance engine required skip", () => {
  test("required step skipped does not satisfy pipeline", async () => {
    const appDir = "/tmp/repo/generated/app";
    const tauriDir = "/tmp/repo/generated/app/src-tauri";
    const snapshot = await createSnapshot(process.cwd(), { paths: [] });
    const evidence = [
      {
        event_type: "acceptance_step_skipped" as const,
        run_id: "run-required-skip",
        turn: 1,
        task_id: "t_verify",
        step_id: "desktop_tauri_default:pnpm_build",
        pipeline_id: "desktop_tauri_default",
        command_id: "pnpm_build",
        reason: "precheck_skip_if_cmd_ran_ok" as const,
        at: new Date().toISOString()
      },
      commandRan({ idx: 1, commandId: "pnpm_install", cmd: "pnpm", argv: ["install"], cwd: appDir }),
      commandRan({ idx: 3, commandId: "cargo_check", cmd: "cargo", argv: ["check"], cwd: tauriDir }),
      commandRan({ idx: 4, commandId: "pnpm_tauri_help", cmd: "pnpm", argv: ["tauri", "--help"], cwd: appDir }),
      commandRan({ idx: 5, commandId: "pnpm_tauri_build", cmd: "pnpm", argv: ["tauri", "build"], cwd: appDir })
    ];

    const result = evaluateAcceptance({
      goal: "verify",
      intent: { type: "verify_acceptance_pipeline", pipeline_id: "desktop_tauri_default" },
      evidence,
      snapshot,
      runtime: { repoRoot: "/tmp/repo", appDir, tauriDir }
    });

    expect(result.status).toBe("pending");
    expect(result.requirements.some((req) => req.kind === "acceptance_step" && req.command_id === "pnpm_build")).toBe(true);
    expect(result.diagnostics.some((d) => d.includes("missing acceptance steps"))).toBe(true);
  });
});
