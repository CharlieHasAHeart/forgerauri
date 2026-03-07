import {
  isEffectResult,
  isFailedEffectResult,
  isSuccessfulEffectResult,
  type AgentState,
  type EffectResult
} from "../protocol/index.js";
import { isAgentStateTerminal } from "./terminal.js";
import { cloneAgentState, transitionAgentState } from "./transition-engine.js";

export function setLastEffectResultKind(
  state: AgentState,
  kind: string | undefined
): AgentState {
  return { ...state, lastEffectResultKind: kind };
}

export function clearCurrentTaskAfterEffect(state: AgentState): AgentState {
  return { ...state, currentTaskId: undefined };
}

export function applySuccessfulEffectResult(
  state: AgentState,
  result: EffectResult
): AgentState {
  const withKind = setLastEffectResultKind(state, result.kind);
  return clearCurrentTaskAfterEffect(withKind);
}

export function applyFailedEffectResult(
  state: AgentState,
  result: EffectResult
): AgentState {
  const withKind = setLastEffectResultKind(state, result.kind);
  return transitionAgentState(withKind, "failed");
}

export function applyEffectResult(
  state: AgentState,
  result: EffectResult | undefined
): AgentState {
  if (isAgentStateTerminal(state)) {
    return cloneAgentState(state);
  }

  if (!result || !isEffectResult(result)) {
    return cloneAgentState(state);
  }

  if (isSuccessfulEffectResult(result)) {
    return applySuccessfulEffectResult(state, result);
  }

  if (isFailedEffectResult(result)) {
    return applyFailedEffectResult(state, result);
  }

  return cloneAgentState(state);
}

export function hasApplicableEffectResult(
  state: AgentState,
  result: EffectResult | undefined
): boolean {
  if (isAgentStateTerminal(state)) {
    return false;
  }

  if (!result) {
    return false;
  }

  return isEffectResult(result);
}
