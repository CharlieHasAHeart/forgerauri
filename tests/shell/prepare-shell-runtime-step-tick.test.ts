import { describe, expect, it } from "vitest";
import { type EffectResult } from "../../src/protocol/index.ts";
import { runRuntimeTick } from "../../src/core/run-runtime-tick.ts";
import { prepareShellRuntimeStepTick } from "../../src/shell/prepare-shell-runtime-step-tick.ts";
import { runShellRuntimeStep } from "../../src/shell/run-shell-runtime.ts";
import {
  makeAgentState,
  minimalAgentState,
  minimalPlan,
  minimalTasks
} from "../shared/minimal-runtime-fixtures.ts";

describe("prepareShellRuntimeStepTick", () => {
  it("matches runRuntimeTick for runnable input", () => {
    const direct = prepareShellRuntimeStepTick(
      minimalAgentState,
      minimalPlan,
      minimalTasks,
      undefined
    );
    const expected = runRuntimeTick(minimalAgentState, minimalPlan, minimalTasks, undefined);

    expect(direct).toEqual(expected);
  });

  it("matches runShellRuntimeStep tick for runnable input", () => {
    const step = runShellRuntimeStep(minimalAgentState, minimalPlan, minimalTasks, undefined);
    const direct = prepareShellRuntimeStepTick(
      minimalAgentState,
      minimalPlan,
      minimalTasks,
      undefined
    );

    expect(direct).toEqual(step.tick);
  });

  it("keeps behavior for successful incoming result", () => {
    const runningState = makeAgentState({ status: "running", currentTaskId: "task-1" });
    const successfulResult: EffectResult = {
      kind: "action_results",
      success: true,
      payload: { count: 1, results: [] },
      context: { handled: true }
    };

    const direct = prepareShellRuntimeStepTick(
      runningState,
      minimalPlan,
      minimalTasks,
      successfulResult
    );
    const expected = runRuntimeTick(runningState, minimalPlan, minimalTasks, successfulResult);

    expect(direct).toEqual(expected);
  });

  it("keeps behavior for failed incoming result", () => {
    const runningState = makeAgentState({ status: "running", currentTaskId: "task-1" });
    const failedResult: EffectResult = {
      kind: "action_results",
      success: false,
      payload: { reason: "failed" },
      context: { handled: false }
    };

    const direct = prepareShellRuntimeStepTick(
      runningState,
      minimalPlan,
      minimalTasks,
      failedResult
    );
    const expected = runRuntimeTick(runningState, minimalPlan, minimalTasks, failedResult);

    expect(direct).toEqual(expected);
  });

  it("keeps terminal input behavior", () => {
    const terminalState = makeAgentState({ status: "done" });

    const direct = prepareShellRuntimeStepTick(
      terminalState,
      minimalPlan,
      minimalTasks,
      undefined
    );
    const expected = runRuntimeTick(terminalState, minimalPlan, minimalTasks, undefined);

    expect(direct).toEqual(expected);
    expect(direct.state).not.toBe(terminalState);
    expect(direct.request).toBeUndefined();
  });
});
