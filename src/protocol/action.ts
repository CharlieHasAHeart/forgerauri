// Protocol-layer standardized action object; keep it serializable across boundaries.
export const ACTION_KINDS = ["tool", "command", "review", "system"] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

export interface Action {
  kind: ActionKind;
  name: string;
  input?: unknown;
  reason?: string;
}

export function isActionKind(value: unknown): value is ActionKind {
  return typeof value === "string" && ACTION_KINDS.some((kind) => kind === value);
}

export function isAction(value: unknown): value is Action {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const kind = Reflect.get(value, "kind");
  const name = Reflect.get(value, "name");
  const reason = Reflect.get(value, "reason");

  if (!isActionKind(kind) || typeof name !== "string") {
    return false;
  }

  return reason === undefined || typeof reason === "string";
}
