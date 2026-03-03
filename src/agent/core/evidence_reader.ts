import { readFile } from "node:fs/promises";
import type { EvidenceEvent, ToolCalledEvent, ToolReturnedEvent } from "./evidence.js";

export type EvidenceReadResult = {
  events: EvidenceEvent[];
  diagnostics: string[];
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isToolCalled = (value: unknown): value is ToolCalledEvent =>
  isObject(value) &&
  value.event_type === "tool_called" &&
  typeof value.run_id === "string" &&
  typeof value.turn === "number" &&
  typeof value.task_id === "string" &&
  typeof value.call_id === "string" &&
  typeof value.tool_name === "string" &&
  typeof value.started_at === "string";

const isToolReturned = (value: unknown): value is ToolReturnedEvent =>
  isObject(value) &&
  value.event_type === "tool_returned" &&
  typeof value.run_id === "string" &&
  typeof value.turn === "number" &&
  typeof value.task_id === "string" &&
  typeof value.call_id === "string" &&
  typeof value.tool_name === "string" &&
  typeof value.ok === "boolean" &&
  typeof value.ended_at === "string";

export const readEvidenceJsonlWithDiagnostics = async (filePath: string): Promise<EvidenceReadResult> => {
  const diagnostics: string[] = [];
  let content = "";
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    diagnostics.push(`failed to read evidence file '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
    return { events: [], diagnostics };
  }

  const events: EvidenceEvent[] = [];
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    const raw = line.trim();
    if (raw.length === 0) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isToolCalled(parsed) || isToolReturned(parsed)) {
        events.push(parsed);
        return;
      }
      if (isObject(parsed) && typeof parsed.event_type === "string") {
        diagnostics.push(`line ${idx + 1}: ignored unsupported event_type '${parsed.event_type}'`);
        return;
      }
      diagnostics.push(`line ${idx + 1}: invalid evidence event shape`);
    } catch (error) {
      diagnostics.push(`line ${idx + 1}: invalid json (${error instanceof Error ? error.message : String(error)})`);
    }
  });

  return { events, diagnostics };
};

export const readEvidenceJsonl = async (filePath: string): Promise<EvidenceEvent[]> => {
  const result = await readEvidenceJsonlWithDiagnostics(filePath);
  return result.events;
};

