import {
  type AgentState,
  type EffectRequest,
  type EffectResult,
  type Plan,
  type Task
} from "../protocol/index.js";
import {
  canRunRuntimeStep,
  runRuntimeTick,
  type RuntimeTickOutput
} from "../core/index.js";
import {
  executeEffectRequest
} from "./execute-effect-request.js";

export interface ShellRuntimeStepOutput {
  tick: RuntimeTickOutput;
  result?: EffectResult;
}

export function runShellRuntimeStep(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[],
  incomingResult: EffectResult | undefined
): ShellRuntimeStepOutput {
  const tick = runRuntimeTick(state, plan, tasks, incomingResult);

  if (!tick.request) {
    return { tick };
  }

  return {
    tick,
    result: executeEffectRequest(tick.request)
  };
}

export function canRunShellRuntimeStep(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[],
  incomingResult: EffectResult | undefined
): boolean {
  return canRunRuntimeStep(state, plan, tasks, incomingResult);
}

export function runShellRuntimeOnce(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[],
  incomingResult: EffectResult | undefined
): AgentState {
  const step = runShellRuntimeStep(state, plan, tasks, incomingResult);
  return step.tick.state;
}

export function peekShellRuntimeRequest(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[],
  incomingResult: EffectResult | undefined
): EffectRequest | undefined {
  const tick = runRuntimeTick(state, plan, tasks, incomingResult);
  return tick.request;
}

export function runShellRuntimeLoop(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[],
  maxSteps: number
): AgentState {
  if (maxSteps <= 0) {
    return state;
  }

  let currentState = state;
  let incomingResult: EffectResult | undefined;

  for (let step = 0; step < maxSteps; step += 1) {
    if (!canRunShellRuntimeStep(currentState, plan, tasks, incomingResult)) {
      break;
    }

    const currentStep = runShellRuntimeStep(currentState, plan, tasks, incomingResult);
    currentState = currentStep.tick.state;
    incomingResult = currentStep.result;
  }

  return currentState;
}
