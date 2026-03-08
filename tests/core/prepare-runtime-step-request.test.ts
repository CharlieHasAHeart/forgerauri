import { describe, expect, it } from "vitest";
import { prepareRuntimeStepRequest } from "../../src/core/prepare-runtime-step-request.ts";
import { peekRuntimeTickRequest, runRuntimeTick } from "../../src/core/run-runtime-tick.ts";
import {
  makeAgentState,
  minimalAgentState,
  minimalPlan,
  minimalTasks
} from "../shared/minimal-runtime-fixtures.ts";

describe("prepareRuntimeStepRequest", () => {
  it("returns request for current minimal runnable input", () => {
    const request = prepareRuntimeStepRequest(minimalAgentState, minimalPlan, minimalTasks);

    expect(request).toBeDefined();
    expect(request?.kind).toBe("execute_actions");
  });

  it("returns undefined for terminal state", () => {
    const doneState = makeAgentState({ status: "done" });
    const failedState = makeAgentState({ status: "failed" });

    expect(prepareRuntimeStepRequest(doneState, minimalPlan, minimalTasks)).toBeUndefined();
    expect(prepareRuntimeStepRequest(failedState, minimalPlan, minimalTasks)).toBeUndefined();
  });

  it("returns undefined when plan is missing", () => {
    expect(prepareRuntimeStepRequest(minimalAgentState, undefined, minimalTasks)).toBeUndefined();
  });

  it("returns undefined when no runnable tasks are available", () => {
    expect(prepareRuntimeStepRequest(minimalAgentState, minimalPlan, [])).toBeUndefined();
  });

  it("matches peekRuntimeTickRequest for current minimal runnable input", () => {
    const direct = prepareRuntimeStepRequest(minimalAgentState, minimalPlan, minimalTasks);
    const peeked = peekRuntimeTickRequest(minimalAgentState, minimalPlan, minimalTasks);

    expect(direct).toEqual(peeked);
  });

  it("matches runRuntimeTick request output for current minimal runnable input", () => {
    const direct = prepareRuntimeStepRequest(minimalAgentState, minimalPlan, minimalTasks);
    const tick = runRuntimeTick(minimalAgentState, minimalPlan, minimalTasks, undefined);

    expect(tick.request).toEqual(direct);
  });
});
