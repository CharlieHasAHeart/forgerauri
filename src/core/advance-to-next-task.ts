import { type AgentState, type Plan, type Task } from "../protocol/index.js";
import { hasRunnableTask, selectNextTask } from "./select-next-task.js";
import { cloneAgentState } from "./transition-engine.js";

export function setCurrentTask(state: AgentState, taskId: string | undefined): AgentState {
  return { ...state, currentTaskId: taskId };
}

export function clearCurrentTask(state: AgentState): AgentState {
  return setCurrentTask(state, undefined);
}

export function advanceToNextTask(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): AgentState {
  const nextTask = selectNextTask(state, plan, tasks);

  if (!nextTask) {
    return clearCurrentTask(state);
  }

  return setCurrentTask(state, nextTask.id);
}

export function hasNextTask(plan: Plan | undefined, tasks: Task[]): boolean {
  if (!plan) {
    return false;
  }

  return hasRunnableTask(plan, tasks);
}

export function preserveOrAdvanceTask(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): AgentState {
  const nextTask = selectNextTask(state, plan, tasks);

  if (state.currentTaskId && nextTask && nextTask.id === state.currentTaskId) {
    return cloneAgentState(state);
  }

  return advanceToNextTask(state, plan, tasks);
}
