import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditEvent } from "./types.js";

const truncate = (value: unknown, max = 50000): unknown => {
  if (typeof value === "string") {
    return value.length > max ? `${value.slice(0, max)}...<truncated>` : value;
  }
  return value;
};

export class AuditCollector {
  private events: AuditEvent[] = [];

  record(kind: AuditEvent["kind"], data: unknown): void {
    this.events.push({ kind, data: truncate(data), ts: Date.now() });
  }

  all(): AuditEvent[] {
    return [...this.events];
  }

  async flush(projectRoot: string): Promise<string> {
    const dir = join(projectRoot, "generated/llm_logs");
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${this.events.length}_${Date.now()}.json`);
    await writeFile(path, JSON.stringify(this.events, null, 2), "utf8");
    return path;
  }
}
