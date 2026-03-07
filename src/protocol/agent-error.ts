// Protocol-layer standardized error object; keep it JSON-serializable across boundaries.
export interface AgentError {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
}

export function isAgentError(value: unknown): value is AgentError {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    typeof Reflect.get(value, "code") === "string" &&
    typeof Reflect.get(value, "message") === "string"
  );
}
