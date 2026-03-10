import {
  type AgentState,
  type EffectResult,
  type Plan,
  type Task
} from "../protocol/index.js";
import { runRuntimeTick, type RuntimeTickOutput } from "../core/index.js";

export function prepareShellRuntimeStepTick(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[],
  incomingResult: EffectResult | undefined
): RuntimeTickOutput {
  return runRuntimeTick(state, plan, tasks, incomingResult);
}
