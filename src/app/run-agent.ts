import { type AgentState, type Plan, type Task } from "../protocol/index.js";
import {
  runShellRuntimeLoop,
  runShellRuntimeStep,
  type ShellRuntimeStepOutput
} from "../shell/index.js";

export interface RunAgentInput {
  state: AgentState;
  plan?: Plan;
  tasks: Task[];
  maxSteps?: number;
}

export interface RunAgentOutput {
  state: AgentState;
}

export function normalizeRunAgentMaxSteps(maxSteps: number | undefined): number {
  if (maxSteps === undefined) {
    return 10;
  }

  if (maxSteps <= 0) {
    return 0;
  }

  return Math.floor(maxSteps);
}

export function runAgentStep(input: RunAgentInput): ShellRuntimeStepOutput {
  return runShellRuntimeStep(input.state, input.plan, input.tasks, undefined);
}

export function runAgent(input: RunAgentInput): RunAgentOutput {
  const maxSteps = normalizeRunAgentMaxSteps(input.maxSteps);
  const finalState = runShellRuntimeLoop(input.state, input.plan, input.tasks, maxSteps);

  return { state: finalState };
}

export function runAgentOnce(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): AgentState {
  return runShellRuntimeLoop(state, plan, tasks, 1);
}

export function runAgentToCompletion(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): AgentState {
  return runShellRuntimeLoop(state, plan, tasks, 10);
}
