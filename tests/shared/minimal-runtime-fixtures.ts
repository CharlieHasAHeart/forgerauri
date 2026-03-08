import type { AgentState, Plan, Task } from "../../src/protocol/index.ts";

export const minimalAgentState: AgentState = {
  runId: "run-1",
  status: "idle",
  goal: "ship feature"
};

export const minimalPlan: Plan = {
  id: "plan-1",
  goal: "ship feature",
  status: "ready",
  taskIds: ["task-1"]
};

export const minimalTasks: Task[] = [
  {
    id: "task-1",
    title: "implement",
    status: "ready"
  }
];

export function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    ...minimalAgentState,
    ...overrides
  };
}

export function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    ...minimalPlan,
    ...overrides
  };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    ...minimalTasks[0],
    ...overrides
  };
}
