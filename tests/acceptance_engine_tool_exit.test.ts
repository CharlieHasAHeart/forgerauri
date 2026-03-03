import { describe, expect, test } from "vitest";
import { evaluateAcceptance } from "../src/agent/core/acceptance_engine.js";
import { createSnapshot } from "../src/agent/core/workspace_snapshot.js";

describe("acceptance engine - verify_tool_exit intent", () => {
  test("satisfied when matching tool_returned exit code exists", async () => {
    const snapshot = await createSnapshot(process.cwd(), { paths: [] });
    const result = evaluateAcceptance({
      goal: "verify",
      intent: { type: "verify_tool_exit", tool_name: "tool_run_command", expect_exit_code: 0 },
      evidence: [
        {
          event_type: "tool_returned",
          run_id: "r1",
          turn: 1,
          task_id: "t1",
          call_id: "c1",
          tool_name: "tool_run_command",
          ok: true,
          ended_at: new Date().toISOString(),
          exit_code: 0
        }
      ],
      snapshot
    });

    expect(result.status).toBe("satisfied");
    expect(result.requirements).toEqual([]);
    expect(result.satisfied_requirements).toEqual([
      { kind: "tool_exit_code", tool_name: "tool_run_command", expect_exit_code: 0 }
    ]);
  });

  test("pending when no matching tool_returned exit code", async () => {
    const snapshot = await createSnapshot(process.cwd(), { paths: [] });
    const result = evaluateAcceptance({
      goal: "verify",
      intent: { type: "verify_tool_exit", tool_name: "tool_run_command", expect_exit_code: 0 },
      evidence: [],
      snapshot
    });

    expect(result.status).toBe("pending");
    expect(result.requirements).toEqual([{ kind: "tool_exit_code", tool_name: "tool_run_command", expect_exit_code: 0 }]);
  });
});

