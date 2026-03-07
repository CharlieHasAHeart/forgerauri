import { isRunStatus, type AgentState, type RunStatus } from "../protocol/index.js";
import { isAgentStateTerminal } from "./terminal.js";

export function cloneAgentState(state: AgentState): AgentState {
  return { ...state };
}

export function setAgentStateStatus(state: AgentState, status: RunStatus): AgentState {
  return { ...state, status };
}

export function canTransitionAgentState(state: AgentState, nextStatus: RunStatus): boolean {
  if (!isRunStatus(state.status)) {
    return false;
  }

  if (state.status === nextStatus) {
    return true;
  }

  if (isAgentStateTerminal(state)) {
    return false;
  }

  return (
    (state.status === "idle" && nextStatus === "running") ||
    (state.status === "running" && nextStatus === "done") ||
    (state.status === "running" && nextStatus === "failed")
  );
}

export function transitionAgentState(state: AgentState, nextStatus: RunStatus): AgentState {
  if (!canTransitionAgentState(state, nextStatus)) {
    return state;
  }

  return setAgentStateStatus(state, nextStatus);
}

export function isAgentStateStuck(state: AgentState): boolean {
  if (!isRunStatus(state.status)) {
    return true;
  }

  if (isAgentStateTerminal(state)) {
    return false;
  }

  return state.status === "idle";
}
