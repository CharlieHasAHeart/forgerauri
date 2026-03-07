// Protocol-layer standardized review result object; keep it serializable across boundaries.
export const REVIEW_STATUSES = ["passed", "failed"] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface ReviewResult {
  status: ReviewStatus;
  summary: string;
  notes?: string;
  failureReason?: string;
}

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === "string" && REVIEW_STATUSES.some((status) => status === value);
}

export function isReviewResult(value: unknown): value is ReviewResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const status = Reflect.get(value, "status");
  const summary = Reflect.get(value, "summary");
  const notes = Reflect.get(value, "notes");
  const failureReason = Reflect.get(value, "failureReason");

  if (!isReviewStatus(status) || typeof summary !== "string") {
    return false;
  }

  return (
    (notes === undefined || typeof notes === "string") &&
    (failureReason === undefined || typeof failureReason === "string")
  );
}

export function isPassedReviewResult(result: ReviewResult): boolean {
  return result.status === "passed";
}

export function isFailedReviewResult(result: ReviewResult): boolean {
  return result.status === "failed";
}
