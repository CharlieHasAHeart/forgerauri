import { describe, expect, it } from "vitest";
import { type EffectResult } from "../../src/protocol/index.ts";
import {
  canExecuteEffectRequest,
  executeEffectRequest
} from "../../src/shell/execute-effect-request.ts";
import {
  canRunShellRuntimeStep,
  shouldContinueShellRuntimeLoop,
  runShellRuntimeLoop,
  runShellRuntimeStep
} from "../../src/shell/run-shell-runtime.ts";
import {
  makeAgentState,
  minimalAgentState,
  minimalPlan,
  minimalTasks
} from "../shared/minimal-runtime-fixtures.ts";

describe("run-shell-runtime", () => {
  const baseState = minimalAgentState;
  const plan = minimalPlan;
  const tasks = minimalTasks;

  it("runShellRuntimeStep returns stable tick/result for runnable input", () => {
    const step = runShellRuntimeStep(baseState, plan, tasks, undefined);

    expect(step).toBeDefined();
    expect(step.tick).toBeDefined();
    expect(step.tick.state).toMatchObject({
      runId: "run-1",
      status: "running",
      goal: "ship feature",
      currentTaskId: "task-1"
    });
    expect(step.tick.request).toMatchObject({ kind: "execute_actions" });
    expect(step.result).toMatchObject({
      kind: "action_results",
      success: true,
      context: { requestKind: "execute_actions", handled: true }
    });
  });

  it("runnable runtime step emits request accepted by effect-entry gate", () => {
    const step = runShellRuntimeStep(baseState, plan, tasks, undefined);

    expect(step.tick.request).toBeDefined();
    expect(canExecuteEffectRequest(step.tick.request)).toBe(true);
    // Current implementation behavior: runnable step emits execute_actions request.
    expect(step.tick.request?.kind).toBe("execute_actions");
  });

  it("runtime step result matches explicit executeEffectRequest(entry) result", () => {
    const step = runShellRuntimeStep(baseState, plan, tasks, undefined);

    expect(step.tick.request).toBeDefined();
    const explicitResult = executeEffectRequest(step.tick.request);

    expect(step.result).toEqual(explicitResult);
  });

  it("next step consumes previous successful incoming result and preserves current updates", () => {
    const firstStep = runShellRuntimeStep(baseState, plan, tasks, undefined);
    const secondStep = runShellRuntimeStep(firstStep.tick.state, plan, tasks, firstStep.result);

    expect(firstStep.result).toMatchObject({
      kind: "action_results",
      success: true
    });
    expect(secondStep.tick.state).toMatchObject({
      status: "running",
      lastEffectResultKind: "action_results",
      currentTaskId: undefined
    });
    expect(secondStep.tick.request).toMatchObject({ kind: "execute_actions" });
    expect(secondStep.result).toMatchObject({
      kind: "action_results",
      success: true
    });
  });

  it("next step consumes failed incoming result and preserves current failure behavior", () => {
    const failedIncoming: EffectResult = {
      kind: "action_results",
      success: false,
      payload: {
        reason: "forced_failure"
      },
      context: {
        handled: false
      }
    };

    const step = runShellRuntimeStep(baseState, plan, tasks, failedIncoming);

    expect(step.tick.state).toMatchObject({
      status: "failed",
      lastEffectResultKind: "action_results"
    });
    expect(step.tick.request).toBeUndefined();
    expect(step.result).toBeUndefined();
  });

  it("runShellRuntimeStep returns tick only when no request is available", () => {
    const terminalState = makeAgentState({
      runId: "run-2",
      status: "done",
      goal: "already finished"
    });

    const step = runShellRuntimeStep(terminalState, plan, tasks, undefined);

    expect(step.tick).toBeDefined();
    expect(step.tick.state).toEqual(terminalState);
    expect(step.tick.state).not.toBe(terminalState);
    expect(step.tick.request).toBeUndefined();
    expect(step.result).toBeUndefined();
  });

  it("when runtime gate is false, step does not produce executable request/result pair", () => {
    const stateWithoutPlan = makeAgentState({
      runId: "run-gate-1",
      status: "idle",
      goal: "missing plan"
    });

    expect(canRunShellRuntimeStep(stateWithoutPlan, undefined, tasks, undefined)).toBe(false);

    const step = runShellRuntimeStep(stateWithoutPlan, undefined, tasks, undefined);

    expect(step.tick.request).toBeUndefined();
    expect(step.result).toBeUndefined();
  });

  it("canRunShellRuntimeStep matches current runtime gate behavior", () => {
    expect(canRunShellRuntimeStep(baseState, plan, tasks, undefined)).toBe(true);

    const terminalState = makeAgentState({
      runId: "run-3",
      status: "failed",
      goal: "stop"
    });

    expect(canRunShellRuntimeStep(terminalState, plan, tasks, undefined)).toBe(false);
    expect(canRunShellRuntimeStep(baseState, undefined, tasks, undefined)).toBe(false);
  });

  it("shouldContinueShellRuntimeLoop returns false for terminal state", () => {
    const terminalState = makeAgentState({
      runId: "run-5",
      status: "done",
      goal: "stop"
    });

    expect(shouldContinueShellRuntimeLoop(terminalState, plan, tasks, undefined)).toBe(false);
  });

  it("shouldContinueShellRuntimeLoop returns false when plan is missing", () => {
    expect(shouldContinueShellRuntimeLoop(baseState, undefined, tasks, undefined)).toBe(false);
  });

  it("shouldContinueShellRuntimeLoop returns true for runnable input", () => {
    expect(shouldContinueShellRuntimeLoop(baseState, plan, tasks, undefined)).toBe(true);
  });

  it("runShellRuntimeLoop stops consistently when continue gate is false", () => {
    const stateWithoutPlan = makeAgentState({
      runId: "run-gate-2",
      status: "idle",
      goal: "missing plan"
    });

    expect(shouldContinueShellRuntimeLoop(stateWithoutPlan, undefined, tasks, undefined)).toBe(false);

    const loopState = runShellRuntimeLoop(stateWithoutPlan, undefined, tasks, 2);

    expect(loopState).toEqual(stateWithoutPlan);
  });

  it("runShellRuntimeLoop returns input state when maxSteps <= 0", () => {
    const result = runShellRuntimeLoop(baseState, plan, tasks, 0);

    expect(result).toBe(baseState);
  });

  it("runShellRuntimeLoop(1) follows runShellRuntimeStep tick.state", () => {
    const step = runShellRuntimeStep(baseState, plan, tasks, undefined);
    const loopState = runShellRuntimeLoop(baseState, plan, tasks, 1);

    expect(loopState).toEqual(step.tick.state);
  });

  it("runShellRuntimeLoop(2) consumes first step result on second iteration", () => {
    const firstStep = runShellRuntimeStep(baseState, plan, tasks, undefined);
    const secondStep = runShellRuntimeStep(firstStep.tick.state, plan, tasks, firstStep.result);

    const loopState = runShellRuntimeLoop(baseState, plan, tasks, 2);

    expect(secondStep.tick.state).toMatchObject({
      status: "running",
      lastEffectResultKind: "action_results",
      currentTaskId: undefined
    });
    expect(loopState).toEqual(secondStep.tick.state);
  });

  it("runShellRuntimeLoop stops after failed incoming result and keeps failure state", () => {
    const failedIncoming: EffectResult = {
      kind: "action_results",
      success: false,
      payload: {
        reason: "forced_failure"
      },
      context: {
        handled: false
      }
    };

    const step = runShellRuntimeStep(baseState, plan, tasks, failedIncoming);
    const loopState = runShellRuntimeLoop(step.tick.state, plan, tasks, 2);

    expect(step.tick.state).toMatchObject({
      status: "failed",
      lastEffectResultKind: "action_results"
    });
    expect(loopState).toMatchObject({
      status: "failed",
      lastEffectResultKind: "action_results"
    });
  });

  it("runShellRuntimeLoop(1) remains consistent with step + effect-entry contract", () => {
    const step = runShellRuntimeStep(baseState, plan, tasks, undefined);
    const loopState = runShellRuntimeLoop(baseState, plan, tasks, 1);
    const explicitResult = executeEffectRequest(step.tick.request);

    expect(step.tick.request).toBeDefined();
    expect(canExecuteEffectRequest(step.tick.request)).toBe(true);
    expect(step.result).toEqual(explicitResult);
    expect(loopState).toEqual(step.tick.state);
  });

  it("runShellRuntimeLoop stays stable when runtime cannot proceed", () => {
    const stateWithoutPlan = makeAgentState({
      runId: "run-4",
      status: "idle",
      goal: "no plan"
    });

    const result = runShellRuntimeLoop(stateWithoutPlan, undefined, tasks, 3);

    expect(result).toBe(stateWithoutPlan);
  });
});
