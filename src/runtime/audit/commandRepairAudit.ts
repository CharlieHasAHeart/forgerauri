import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditEvent } from "../types.js";

const truncate = (value: unknown, max = 50000): unknown => {
  if (typeof value === "string") {
    return value.length > max ? `${value.slice(0, max)}...<truncated>` : value;
  }
  return value;
};

const nextCounter = async (dir: string): Promise<number> => {
  try {
    const files = await readdir(dir);
    const numbers = files
      .map((name) => {
        const m = name.match(/^(\d+)\.json$/);
        return m ? Number(m[1]) : -1;
      })
      .filter((num) => num >= 0);
    if (numbers.length === 0) return 1;
    return Math.max(...numbers) + 1;
  } catch {
    return 1;
  }
};

export class CommandRepairAuditCollector {
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
    const counter = await nextCounter(dir);
    const path = join(dir, `${String(counter).padStart(4, "0")}.json`);
    await writeFile(path, JSON.stringify(this.events, null, 2), "utf8");
    return path;
  }
}
