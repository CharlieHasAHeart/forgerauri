import {
  type AgentState,
  type EffectRequest,
  type EffectResult,
  type Plan,
  type Task
} from "../protocol/index.js";
import { driveCoreRun, isCoreRunStable } from "./drive-core-run.js";
import { canRunEffectCycle, prepareEffectCycle, runEffectCycle } from "./run-effect-cycle.js";
import { isAgentStateTerminal } from "./terminal.js";
import { cloneAgentState } from "./transition-engine.js";

export interface RuntimeTickOutput {
  state: AgentState;
  request?: EffectRequest;
}

export function prepareRuntimeTickState(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): AgentState {
  if (isAgentStateTerminal(state)) {
    return cloneAgentState(state);
  }

  return driveCoreRun(state, plan, tasks);
}

export function prepareRuntimeTickRequest(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): EffectRequest | undefined {
  if (isAgentStateTerminal(state)) {
    return undefined;
  }

  return prepareEffectCycle(state, plan, tasks);
}

export function applyRuntimeTickResult(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[],
  result: EffectResult | undefined
): AgentState {
  if (isAgentStateTerminal(state)) {
    return cloneAgentState(state);
  }

  if (!canRunEffectCycle(state, plan, tasks, result)) {
    return cloneAgentState(state);
  }

  return runEffectCycle(state, plan, tasks, result);
}

export function runRuntimeTick(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[],
  result: EffectResult | undefined
): RuntimeTickOutput {
  if (isAgentStateTerminal(state)) {
    return { state: cloneAgentState(state) };
  }

  const preparedState = prepareRuntimeTickState(state, plan, tasks);
  const appliedState = applyRuntimeTickResult(preparedState, plan, tasks, result);
  const request = prepareRuntimeTickRequest(appliedState, plan, tasks);

  return {
    state: appliedState,
    request
  };
}

export function canRunRuntimeTick(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[],
  result: EffectResult | undefined
): boolean {
  if (isAgentStateTerminal(state)) {
    return false;
  }

  return !isCoreRunStable(state, plan, tasks) || canRunEffectCycle(state, plan, tasks, result);
}

export function peekRuntimeTickRequest(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): EffectRequest | undefined {
  const preparedState = prepareRuntimeTickState(state, plan, tasks);
  return prepareRuntimeTickRequest(preparedState, plan, tasks);
}
