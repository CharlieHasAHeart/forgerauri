import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EvidenceEvent } from "./types.js";

export class EvidenceLogger {
  private readonly filePath: string;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private initialized = false;

  constructor(args: { filePath: string }) {
    this.filePath = args.filePath;
  }

  append(event: EvidenceEvent): void {
    if (this.closed) return;
    this.queue = this.queue
      .then(async () => {
        if (this.closed) return;
        try {
          if (!this.initialized) {
            await mkdir(dirname(this.filePath), { recursive: true });
            this.initialized = true;
          }
          await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
        } catch {
          // Evidence logging must never crash the agent runtime.
        }
      })
      .catch(() => {
        // Keep queue chain alive even if prior write failed.
      });
  }

  async flush(): Promise<void> {
    try {
      await this.queue;
    } catch {
      // Do not throw from logger.
    }
  }

  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
  }
}
