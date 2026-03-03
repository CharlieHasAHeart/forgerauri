import { describe, expect, test } from "vitest";
import { evaluateAcceptance } from "../src/agent/core/acceptance_engine.js";
import { createSnapshot } from "../src/agent/core/workspace_snapshot.js";

const makeCommandRan = (args: {
  cmd: string;
  argv: string[];
  cwd: string;
  ok?: boolean;
  exitCode?: number;
  idx: number;
}) => ({
  event_type: "command_ran" as const,
  run_id: "run-pipeline",
  turn: 1,
  task_id: "t_verify",
  call_id: `c-${args.idx}`,
  cmd: args.cmd,
  args: args.argv,
  cwd: args.cwd,
  ok: args.ok ?? true,
  exit_code: args.exitCode ?? 0,
  at: new Date().toISOString()
});

describe("acceptance engine - verify_acceptance_pipeline", () => {
  test("satisfied when desktop_tauri_default steps all appear", async () => {
    const appDir = "./generated/app";
    const snapshot = await createSnapshot(process.cwd(), { paths: [] });
    const evidence = [
      makeCommandRan({ idx: 1, cmd: "pnpm", argv: ["install"], cwd: appDir }),
      makeCommandRan({ idx: 2, cmd: "pnpm", argv: ["build"], cwd: appDir }),
      makeCommandRan({ idx: 3, cmd: "cargo", argv: ["check"], cwd: `${appDir}/src-tauri` }),
      makeCommandRan({ idx: 4, cmd: "pnpm", argv: ["tauri", "--help"], cwd: appDir }),
      makeCommandRan({ idx: 5, cmd: "pnpm", argv: ["tauri", "build"], cwd: appDir })
    ];

    const result = evaluateAcceptance({
      goal: "verify desktop app",
      intent: { type: "verify_acceptance_pipeline", pipeline_id: "desktop_tauri_default" },
      evidence,
      snapshot,
      runtime: { appDir, tauriDir: `${appDir}/src-tauri`, repoRoot: process.cwd() }
    });

    expect(result.status).toBe("satisfied");
    expect(result.requirements).toEqual([]);
    expect(result.satisfied_requirements).toHaveLength(5);
  });

  test("pending when one required step is missing", async () => {
    const appDir = "./generated/app";
    const snapshot = await createSnapshot(process.cwd(), { paths: [] });
    const evidence = [
      makeCommandRan({ idx: 1, cmd: "pnpm", argv: ["install"], cwd: appDir }),
      makeCommandRan({ idx: 2, cmd: "pnpm", argv: ["build"], cwd: appDir }),
      makeCommandRan({ idx: 3, cmd: "cargo", argv: ["check"], cwd: `${appDir}/src-tauri` }),
      makeCommandRan({ idx: 4, cmd: "pnpm", argv: ["tauri", "--help"], cwd: appDir })
    ];

    const result = evaluateAcceptance({
      goal: "verify desktop app",
      intent: { type: "verify_acceptance_pipeline", pipeline_id: "desktop_tauri_default" },
      evidence,
      snapshot,
      runtime: { appDir, tauriDir: `${appDir}/src-tauri`, repoRoot: process.cwd() }
    });

    expect(result.status).toBe("pending");
    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0]).toMatchObject({ kind: "acceptance_step", command_id: "pnpm_tauri_build" });
  });

  test("strict_order toggles ordering behavior", async () => {
    const appDir = "./generated/app";
    const snapshot = await createSnapshot(process.cwd(), { paths: [] });
    const shuffledEvidence = [
      makeCommandRan({ idx: 1, cmd: "pnpm", argv: ["build"], cwd: appDir }),
      makeCommandRan({ idx: 2, cmd: "pnpm", argv: ["install"], cwd: appDir }),
      makeCommandRan({ idx: 3, cmd: "cargo", argv: ["check"], cwd: `${appDir}/src-tauri` }),
      makeCommandRan({ idx: 4, cmd: "pnpm", argv: ["tauri", "--help"], cwd: appDir }),
      makeCommandRan({ idx: 5, cmd: "pnpm", argv: ["tauri", "build"], cwd: appDir })
    ];

    const strictResult = evaluateAcceptance({
      goal: "verify desktop app",
      intent: { type: "verify_acceptance_pipeline", pipeline_id: "desktop_tauri_default", strict_order: true },
      evidence: shuffledEvidence,
      snapshot,
      runtime: { appDir, tauriDir: `${appDir}/src-tauri`, repoRoot: process.cwd() }
    });
    expect(strictResult.status).toBe("pending");

    const relaxedResult = evaluateAcceptance({
      goal: "verify desktop app",
      intent: { type: "verify_acceptance_pipeline", pipeline_id: "desktop_tauri_default", strict_order: false },
      evidence: shuffledEvidence,
      snapshot,
      runtime: { appDir, tauriDir: `${appDir}/src-tauri`, repoRoot: process.cwd() }
    });
    expect(relaxedResult.status).toBe("satisfied");
  });
});
