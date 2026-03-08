import { type AgentState, type EffectRequest, type Plan, type Task } from "../protocol/index.js";
import { prepareEffectCycle } from "./run-effect-cycle.js";
import { isAgentStateTerminal } from "./terminal.js";

export function prepareRuntimeStepRequest(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): EffectRequest | undefined {
  if (isAgentStateTerminal(state)) {
    return undefined;
  }

  return prepareEffectCycle(state, plan, tasks);
}
