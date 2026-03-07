import { type AgentState } from "../protocol/index.js";
import { cloneAgentState, transitionAgentState } from "./transition-engine.js";
import { isAgentStateTerminal } from "./terminal.js";

export function initializeAgentRun(state: AgentState): AgentState {
  if (isAgentStateTerminal(state)) {
    return cloneAgentState(state);
  }

  return cloneAgentState(transitionAgentState(state, "running"));
}

export function finalizeAgentRun(state: AgentState, succeeded: boolean): AgentState {
  const nextStatus = succeeded ? "done" : "failed";
  return cloneAgentState(transitionAgentState(state, nextStatus));
}

export function runCoreAgent(state: AgentState): AgentState {
  if (isAgentStateTerminal(state)) {
    return cloneAgentState(state);
  }

  const startedState = initializeAgentRun(state);

  if (isAgentStateTerminal(startedState)) {
    return startedState;
  }

  return finalizeAgentRun(startedState, true);
}

export function failCoreAgent(state: AgentState): AgentState {
  if (isAgentStateTerminal(state)) {
    return cloneAgentState(state);
  }

  return finalizeAgentRun(state, false);
}
