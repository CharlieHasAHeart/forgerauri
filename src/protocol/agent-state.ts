// Protocol-layer standardized agent state object; keep it serializable across boundaries.
export interface AgentState {
  runId: string;
  status: string;
  goal: string;
  planId?: string;
  currentTaskId?: string;
  currentMilestoneId?: string;
  lastEffectRequestKind?: string;
  lastEffectResultKind?: string;
  failure?: unknown;
}

export function isAgentState(value: unknown): value is AgentState {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const runId = Reflect.get(value, "runId");
  const status = Reflect.get(value, "status");
  const goal = Reflect.get(value, "goal");
  const planId = Reflect.get(value, "planId");
  const currentTaskId = Reflect.get(value, "currentTaskId");
  const currentMilestoneId = Reflect.get(value, "currentMilestoneId");
  const lastEffectRequestKind = Reflect.get(value, "lastEffectRequestKind");
  const lastEffectResultKind = Reflect.get(value, "lastEffectResultKind");

  if (typeof runId !== "string" || typeof status !== "string" || typeof goal !== "string") {
    return false;
  }

  return (
    (planId === undefined || typeof planId === "string") &&
    (currentTaskId === undefined || typeof currentTaskId === "string") &&
    (currentMilestoneId === undefined || typeof currentMilestoneId === "string") &&
    (lastEffectRequestKind === undefined || typeof lastEffectRequestKind === "string") &&
    (lastEffectResultKind === undefined || typeof lastEffectResultKind === "string")
  );
}
