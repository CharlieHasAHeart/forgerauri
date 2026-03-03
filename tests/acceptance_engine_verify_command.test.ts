import { describe, expect, test } from "vitest";
import { evaluateAcceptance } from "../src/agent/core/acceptance/engine.js";
import { createSnapshot } from "../src/agent/core/workspace/snapshot.js";

describe("acceptance engine - verify_command intent", () => {
  test("satisfied when command_ran matches cmd/args/cwd/exit_code", async () => {
    const snapshot = await createSnapshot(process.cwd(), { paths: [] });
    const result = evaluateAcceptance({
      goal: "verify command",
      intent: {
        type: "verify_command",
        cmd: "pnpm",
        args: ["test"],
        cwd: "./generated/app",
        expect_exit_code: 0
      },
      evidence: [
        {
          event_type: "command_ran",
          run_id: "r1",
          turn: 1,
          task_id: "t1",
          call_id: "c1",
          cmd: "pnpm",
          args: ["test"],
          cwd: "./generated/app",
          ok: true,
          exit_code: 0,
          at: new Date().toISOString()
        }
      ],
      snapshot
    });

    expect(result.status).toBe("satisfied");
    expect(result.requirements).toEqual([]);
  });

  test("pending when args differ even if exit code is 0", async () => {
    const snapshot = await createSnapshot(process.cwd(), { paths: [] });
    const result = evaluateAcceptance({
      goal: "verify command",
      intent: {
        type: "verify_command",
        cmd: "pnpm",
        args: ["test"],
        cwd: "./generated/app",
        expect_exit_code: 0
      },
      evidence: [
        {
          event_type: "command_ran",
          run_id: "r1",
          turn: 1,
          task_id: "t1",
          call_id: "c1",
          cmd: "pnpm",
          args: ["build"],
          cwd: "./generated/app",
          ok: true,
          exit_code: 0,
          at: new Date().toISOString()
        }
      ],
      snapshot
    });

    expect(result.status).toBe("pending");
    expect(result.requirements).toEqual([
      {
        kind: "command_exit",
        cmd: "pnpm",
        args: ["test"],
        cwd: "./generated/app",
        expect_exit_code: 0
      }
    ]);
  });
});

