// Run-level lifecycle status for an agent run (not task/action status).
export const RUN_STATUSES = ["idle", "running", "done", "failed"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && RUN_STATUSES.some((status) => status === value);
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "done" || status === "failed";
}
