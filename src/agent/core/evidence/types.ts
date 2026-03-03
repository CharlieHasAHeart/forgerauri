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

export type CommandRanEvent = {
  event_type: "command_ran";
  run_id: string;
  turn: number;
  task_id: string;
  call_id: string;
  command_id?: string;
  cmd: string;
  args: string[];
  cwd: string;
  ok: boolean;
  exit_code: number;
  stdout_tail?: string;
  stderr_tail?: string;
  at: string;
};

export type AcceptanceStepStartedEvent = {
  event_type: "acceptance_step_started";
  run_id: string;
  turn: number;
  task_id: string;
  step_id: string;
  pipeline_id: string;
  command_id: string;
  at: string;
};

export type AcceptanceStepSkippedEvent = {
  event_type: "acceptance_step_skipped";
  run_id: string;
  turn: number;
  task_id: string;
  step_id: string;
  pipeline_id: string;
  command_id: string;
  reason: "precheck_skip_if_exists" | "precheck_skip_if_cmd_ran_ok";
  at: string;
};

export type AcceptanceStepFinishedEvent = {
  event_type: "acceptance_step_finished";
  run_id: string;
  turn: number;
  task_id: string;
  step_id: string;
  pipeline_id: string;
  command_id: string;
  ok: boolean;
  exit_code?: number;
  at: string;
};

export type AcceptanceStepEvent = AcceptanceStepStartedEvent | AcceptanceStepSkippedEvent | AcceptanceStepFinishedEvent;

export type EvidenceEvent = ToolCalledEvent | ToolReturnedEvent | CommandRanEvent | AcceptanceStepEvent;

const truncate = (value: string, max = 2000): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

export const tail = (value: string, max = 4000): string => {
  if (value.length <= max) return value;
  return `...<truncated>${value.slice(value.length - max)}`;
};

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
