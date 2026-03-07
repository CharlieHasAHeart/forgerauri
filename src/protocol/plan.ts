// Protocol-layer standardized plan object; keep it serializable across boundaries.
export const PLAN_STATUSES = ["draft", "ready", "in_progress", "completed", "failed"] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface Plan {
  id: string;
  goal: string;
  status: PlanStatus;
  summary?: string;
  milestoneIds?: string[];
  taskIds?: string[];
  successCriteria?: unknown[];
}

export function isPlanStatus(value: unknown): value is PlanStatus {
  return typeof value === "string" && PLAN_STATUSES.some((status) => status === value);
}

export function isPlan(value: unknown): value is Plan {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const id = Reflect.get(value, "id");
  const goal = Reflect.get(value, "goal");
  const status = Reflect.get(value, "status");
  const summary = Reflect.get(value, "summary");
  const milestoneIds = Reflect.get(value, "milestoneIds");
  const taskIds = Reflect.get(value, "taskIds");
  const successCriteria = Reflect.get(value, "successCriteria");

  if (typeof id !== "string" || typeof goal !== "string" || !isPlanStatus(status)) {
    return false;
  }

  return (
    (summary === undefined || typeof summary === "string") &&
    (milestoneIds === undefined ||
      (Array.isArray(milestoneIds) && milestoneIds.every((id) => typeof id === "string"))) &&
    (taskIds === undefined || (Array.isArray(taskIds) && taskIds.every((id) => typeof id === "string"))) &&
    (successCriteria === undefined || Array.isArray(successCriteria))
  );
}

export function isTerminalPlanStatus(status: PlanStatus): boolean {
  return status === "completed" || status === "failed";
}
