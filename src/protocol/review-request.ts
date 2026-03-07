// Protocol-layer standardized review request object; keep it serializable across boundaries.
export const REVIEW_KINDS = ["task", "milestone", "goal", "system"] as const;

export type ReviewKind = (typeof REVIEW_KINDS)[number];

export interface ReviewRequest {
  kind: ReviewKind;
  target: string;
  summary: string;
  criteria?: unknown;
  evidenceRefs?: string[];
}

export function isReviewKind(value: unknown): value is ReviewKind {
  return typeof value === "string" && REVIEW_KINDS.some((kind) => kind === value);
}

export function isReviewRequest(value: unknown): value is ReviewRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const kind = Reflect.get(value, "kind");
  const target = Reflect.get(value, "target");
  const summary = Reflect.get(value, "summary");
  const evidenceRefs = Reflect.get(value, "evidenceRefs");

  if (!isReviewKind(kind) || typeof target !== "string" || typeof summary !== "string") {
    return false;
  }

  return (
    evidenceRefs === undefined ||
    (Array.isArray(evidenceRefs) && evidenceRefs.every((ref) => typeof ref === "string"))
  );
}
