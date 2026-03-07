import { type AgentState, type Plan, type Task } from "../protocol/index.js";
import { advanceToNextTask, hasNextTask } from "./advance-to-next-task.js";
import { finalizeAgentRun, initializeAgentRun } from "./run-core-agent.js";
import { isAgentStateTerminal } from "./terminal.js";
import { cloneAgentState } from "./transition-engine.js";

export function prepareSingleStep(state: AgentState): AgentState {
  if (isAgentStateTerminal(state)) {
    return cloneAgentState(state);
  }

  return initializeAgentRun(state);
}

export function completeSingleStep(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): AgentState {
  if (isAgentStateTerminal(state)) {
    return cloneAgentState(state);
  }

  if (!hasNextTask(plan, tasks)) {
    return finalizeAgentRun(state, true);
  }

  return advanceToNextTask(state, plan, tasks);
}

export function runSingleStep(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): AgentState {
  if (isAgentStateTerminal(state)) {
    return cloneAgentState(state);
  }

  const preparedState = prepareSingleStep(state);

  if (isAgentStateTerminal(preparedState)) {
    return preparedState;
  }

  return completeSingleStep(preparedState, plan, tasks);
}

export function canRunSingleStep(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): boolean {
  if (isAgentStateTerminal(state)) {
    return false;
  }

  return plan !== undefined && hasNextTask(plan, tasks);
}

export function finishIfNoNextTask(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): AgentState {
  if (isAgentStateTerminal(state)) {
    return cloneAgentState(state);
  }

  if (!hasNextTask(plan, tasks)) {
    return finalizeAgentRun(state, true);
  }

  return cloneAgentState(state);
}
