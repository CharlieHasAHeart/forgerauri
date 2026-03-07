// Protocol-layer structured context object; keep it serializable across boundaries.
export const CONTEXT_PHASES = ["planning", "execution", "review", "recovery"] as const;

export type ContextPhase = (typeof CONTEXT_PHASES)[number];

export interface ContextPacket {
  phase: ContextPhase;
  goal: string;
  summary: string;
  inputs?: unknown;
  evidenceRefs?: string[];
}

export function isContextPhase(value: unknown): value is ContextPhase {
  return typeof value === "string" && CONTEXT_PHASES.some((phase) => phase === value);
}

export function isContextPacket(value: unknown): value is ContextPacket {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const phase = Reflect.get(value, "phase");
  const goal = Reflect.get(value, "goal");
  const summary = Reflect.get(value, "summary");
  const evidenceRefs = Reflect.get(value, "evidenceRefs");

  if (!isContextPhase(phase) || typeof goal !== "string" || typeof summary !== "string") {
    return false;
  }

  return (
    evidenceRefs === undefined ||
    (Array.isArray(evidenceRefs) && evidenceRefs.every((ref) => typeof ref === "string"))
  );
}
