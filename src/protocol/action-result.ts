// Protocol-layer standardized action result object; keep it serializable across boundaries.
export const ACTION_RESULT_STATUSES = ["succeeded", "failed"] as const;

export type ActionResultStatus = (typeof ACTION_RESULT_STATUSES)[number];

export interface ActionResult {
  status: ActionResultStatus;
  actionName: string;
  output?: unknown;
  errorMessage?: string;
}

export function isActionResultStatus(value: unknown): value is ActionResultStatus {
  return (
    typeof value === "string" &&
    ACTION_RESULT_STATUSES.some((status) => status === value)
  );
}

export function isActionResult(value: unknown): value is ActionResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const status = Reflect.get(value, "status");
  const actionName = Reflect.get(value, "actionName");
  const errorMessage = Reflect.get(value, "errorMessage");

  if (!isActionResultStatus(status) || typeof actionName !== "string") {
    return false;
  }

  return errorMessage === undefined || typeof errorMessage === "string";
}

export function isSuccessfulActionResult(result: ActionResult): boolean {
  return result.status === "succeeded";
}

export function isFailedActionResult(result: ActionResult): boolean {
  return result.status === "failed";
}
