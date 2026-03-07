// Protocol-layer structured evidence object; keep it serializable across boundaries.
export const EVIDENCE_SOURCES = ["tool", "command", "review", "system"] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export interface Evidence {
  source: EvidenceSource;
  summary: string;
  details?: unknown;
  artifactRef?: string;
}

export function isEvidenceSource(value: unknown): value is EvidenceSource {
  return (
    typeof value === "string" && EVIDENCE_SOURCES.some((source) => source === value)
  );
}

export function isEvidence(value: unknown): value is Evidence {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const source = Reflect.get(value, "source");
  const summary = Reflect.get(value, "summary");
  const artifactRef = Reflect.get(value, "artifactRef");

  if (!isEvidenceSource(source) || typeof summary !== "string") {
    return false;
  }

  return artifactRef === undefined || typeof artifactRef === "string";
}
