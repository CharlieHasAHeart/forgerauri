import {
  isRunStatus,
  isTerminalMilestoneStatus,
  isTerminalPlanStatus,
  isTerminalRunStatus,
  isTerminalTaskStatus,
  type AgentState,
  type MilestoneStatus,
  type PlanStatus,
  type RunStatus,
  type TaskStatus
} from "../protocol/index.js";

export function isRunTerminal(status: RunStatus): boolean {
  return isTerminalRunStatus(status);
}

export function isTaskTerminal(status: TaskStatus): boolean {
  return isTerminalTaskStatus(status);
}

export function isMilestoneTerminal(status: MilestoneStatus): boolean {
  return isTerminalMilestoneStatus(status);
}

export function isPlanTerminal(status: PlanStatus): boolean {
  return isTerminalPlanStatus(status);
}

export function isAgentStateTerminal(state: AgentState): boolean {
  return isRunStatus(state.status) && isTerminalRunStatus(state.status);
}
