import {
  type AgentState,
  type EffectRequest,
  type EffectResult,
  type Plan,
  type Task
} from "../protocol/index.js";
import { applyEffectResult, hasApplicableEffectResult } from "./apply-effect-result.js";
import {
  buildNextEffectRequest,
  ensureEffectRequest,
  hasEffectRequest
} from "./build-effect-request.js";
import { isAgentStateTerminal } from "./terminal.js";
import { cloneAgentState } from "./transition-engine.js";

export function prepareEffectCycle(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): EffectRequest | undefined {
  if (isAgentStateTerminal(state)) {
    return undefined;
  }

  return ensureEffectRequest(state, plan, tasks);
}

export function applyEffectCycleResult(
  state: AgentState,
  result: EffectResult | undefined
): AgentState {
  if (isAgentStateTerminal(state)) {
    return cloneAgentState(state);
  }

  return applyEffectResult(state, result);
}

export function runEffectCycle(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[],
  result: EffectResult | undefined
): AgentState {
  if (isAgentStateTerminal(state)) {
    return cloneAgentState(state);
  }

  if (hasApplicableEffectResult(state, result)) {
    return applyEffectCycleResult(state, result);
  }

  return cloneAgentState(state);
}

export function peekNextEffectRequest(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): EffectRequest | undefined {
  return buildNextEffectRequest(state, plan, tasks);
}

export function canRunEffectCycle(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[],
  result: EffectResult | undefined
): boolean {
  if (isAgentStateTerminal(state)) {
    return false;
  }

  return hasEffectRequest(state, plan, tasks) || hasApplicableEffectResult(state, result);
}
