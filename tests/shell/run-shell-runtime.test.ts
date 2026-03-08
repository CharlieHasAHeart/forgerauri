import { describe, expect, it } from "vitest";
import type { AgentState, Plan, Task } from "../../src/protocol/index.ts";
import {
  canExecuteEffectRequest,
  executeEffectRequest
} from "../../src/shell/execute-effect-request.ts";
import {
  canRunShellRuntimeStep,
  runShellRuntimeLoop,
  runShellRuntimeStep
} from "../../src/shell/run-shell-runtime.ts";

describe("run-shell-runtime", () => {
  const baseState: AgentState = {
    runId: "run-1",
    status: "idle",
    goal: "ship feature"
  };

  const plan: Plan = {
    id: "plan-1",
    goal: "ship feature",
    status: "ready",
    taskIds: ["task-1"]
  };

  const tasks: Task[] = [
    {
      id: "task-1",
      title: "implement",
      status: "ready"
    }
  ];

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

  it("runShellRuntimeStep returns tick only when no request is available", () => {
    const terminalState: AgentState = {
      runId: "run-2",
      status: "done",
      goal: "already finished"
    };

    const step = runShellRuntimeStep(terminalState, plan, tasks, undefined);

    expect(step.tick).toBeDefined();
    expect(step.tick.state).toEqual(terminalState);
    expect(step.tick.state).not.toBe(terminalState);
    expect(step.tick.request).toBeUndefined();
    expect(step.result).toBeUndefined();
  });

  it("when runtime gate is false, step does not produce executable request/result pair", () => {
    const stateWithoutPlan: AgentState = {
      runId: "run-gate-1",
      status: "idle",
      goal: "missing plan"
    };

    expect(canRunShellRuntimeStep(stateWithoutPlan, undefined, tasks, undefined)).toBe(false);

    const step = runShellRuntimeStep(stateWithoutPlan, undefined, tasks, undefined);

    expect(step.tick.request).toBeUndefined();
    expect(step.result).toBeUndefined();
  });

  it("canRunShellRuntimeStep matches current runtime gate behavior", () => {
    expect(canRunShellRuntimeStep(baseState, plan, tasks, undefined)).toBe(true);

    const terminalState: AgentState = {
      runId: "run-3",
      status: "failed",
      goal: "stop"
    };

    expect(canRunShellRuntimeStep(terminalState, plan, tasks, undefined)).toBe(false);
    expect(canRunShellRuntimeStep(baseState, undefined, tasks, undefined)).toBe(false);
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
    const stateWithoutPlan: AgentState = {
      runId: "run-4",
      status: "idle",
      goal: "no plan"
    };

    const result = runShellRuntimeLoop(stateWithoutPlan, undefined, tasks, 3);

    expect(result).toBe(stateWithoutPlan);
  });
});
