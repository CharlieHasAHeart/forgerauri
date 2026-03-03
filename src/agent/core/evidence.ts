export type ToolCalledEvent = {
  event_type: "tool_called";
  run_id: string;
  turn: number;
  task_id: string;
  call_id: string;
  tool_name: string;
  input: unknown;
  started_at: string;
};

export type ToolReturnedEvent = {
  event_type: "tool_returned";
  run_id: string;
  turn: number;
  task_id: string;
  call_id: string;
  tool_name: string;
  ok: boolean;
  ended_at: string;
  note?: string;
  touched_paths?: string[];
  output_summary?: string;
  exit_code?: number;
};

export type EvidenceEvent = ToolCalledEvent | ToolReturnedEvent;

const truncate = (value: string, max = 2000): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

export const summarizeForEvidence = (value: unknown, max = 2000): string => {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return truncate(value, max);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return truncate(JSON.stringify(value), max);
  } catch {
    return truncate(String(value), max);
  }
};

