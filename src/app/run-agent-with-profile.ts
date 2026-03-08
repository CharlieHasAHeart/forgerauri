import { type AgentState, type Plan, type Task } from "../protocol/index.js";
import {
  type RunAgentInput,
  type RunAgentOutput,
  runAgent,
  runAgentOnce,
  runAgentToCompletion
} from "./run-agent.js";
import {
  type AgentProfile,
  getDefaultProfile,
  isReviewEnabled,
  isShellExecutionAllowed,
  resolveProfileMaxSteps,
  shouldAutoRunToCompletion
} from "../profiles/default-profile.js";

export interface RunAgentWithProfileInput {
  state: AgentState;
  plan?: Plan;
  tasks: Task[];
  profile?: AgentProfile;
}

export function resolveAgentProfile(profile: AgentProfile | undefined): AgentProfile {
  if (profile) {
    return { ...profile };
  }

  return getDefaultProfile();
}

export function buildRunAgentInputFromProfile(
  input: RunAgentWithProfileInput
): RunAgentInput {
  const profile = resolveAgentProfile(input.profile);

  return {
    state: input.state,
    plan: input.plan,
    tasks: input.tasks,
    maxSteps: resolveProfileMaxSteps(profile)
  };
}

export function runAgentWithProfile(input: RunAgentWithProfileInput): RunAgentOutput {
  const profile = resolveAgentProfile(input.profile);

  if (!isShellExecutionAllowed(profile)) {
    return { state: input.state };
  }

  const reviewEnabled = isReviewEnabled(profile);
  void reviewEnabled;

  if (shouldAutoRunToCompletion(profile)) {
    const runInput = buildRunAgentInputFromProfile(input);
    return runAgent(runInput);
  }

  return { state: runAgentOnce(input.state, input.plan, input.tasks) };
}

export function runAgentWithDefaultProfile(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): RunAgentOutput {
  return runAgentWithProfile({ state, plan, tasks });
}

export function runAgentToProfileCompletion(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[],
  profile: AgentProfile | undefined
): AgentState {
  const resolvedProfile = resolveAgentProfile(profile);

  if (!isShellExecutionAllowed(resolvedProfile)) {
    return state;
  }

  if (shouldAutoRunToCompletion(resolvedProfile)) {
    return runAgentToCompletion(state, plan, tasks);
  }

  return runAgentOnce(state, plan, tasks);
}
