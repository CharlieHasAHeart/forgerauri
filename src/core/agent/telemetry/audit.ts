import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nextJsonCounter } from "./audit_counter.js";

export type AgentTurnAuditEntry = {
  turn: number;
  llmRaw: string;
  llmPreviousResponseId?: string;
  llmResponseId?: string;
  llmUsage?: unknown;
  toolCalls: Array<{ name: string; input: unknown }>;
  toolResults: Array<{ name: string; ok: boolean; error?: string; touchedPaths?: string[] }>;
  note?: string;
};

const truncate = (value: string, max = 60000): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

export class AgentTurnAuditCollector {
  private readonly goal: string;
  private readonly turns: AgentTurnAuditEntry[] = [];
  private filePath?: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private startedAt = new Date().toISOString();
  private startup?: {
    specRef?: string;
    outDir?: string;
    providerName?: string;
    model?: string;
    truncation?: "auto" | "disabled";
    compactionThreshold?: number;
  };

  constructor(goal: string) {
    this.goal = goal;
  }

  private payload(final?: unknown): unknown {
    return {
      goal: this.goal,
      startedAt: this.startedAt,
      startup: this.startup,
      turns: this.turns,
      final: final ?? { status: "running" }
    };
  }

  private queueWrite(final?: unknown): void {
    if (!this.filePath) return;
    const path = this.filePath;
    const content = JSON.stringify(this.payload(final), null, 2);
    this.writeQueue = this.writeQueue.then(() => writeFile(path, content, "utf8"));
  }

  async start(
    baseRoot: string,
    startup?: {
      specRef?: string;
      outDir?: string;
      providerName?: string;
      model?: string;
      truncation?: "auto" | "disabled";
      compactionThreshold?: number;
    }
  ): Promise<string> {
    if (startup) {
      this.startup = startup;
    }
    if (this.filePath) return this.filePath;
    const dir = join(baseRoot, "generated/agent_logs");
    await mkdir(dir, { recursive: true });
    const counter = await nextJsonCounter(dir);
    this.filePath = join(dir, `${String(counter).padStart(4, "0")}.json`);
    this.queueWrite();
    await this.writeQueue;
    return this.filePath;
  }

  recordTurn(entry: AgentTurnAuditEntry): void {
    this.turns.push({
      ...entry,
      llmRaw: truncate(entry.llmRaw),
      llmPreviousResponseId: entry.llmPreviousResponseId ? truncate(entry.llmPreviousResponseId, 200) : undefined,
      llmResponseId: entry.llmResponseId ? truncate(entry.llmResponseId, 200) : undefined,
      llmUsage: entry.llmUsage,
      toolResults: entry.toolResults.map((result) => ({
        ...result,
        error: result.error ? truncate(result.error, 8000) : undefined,
        touchedPaths: result.touchedPaths?.slice(0, 200)
      }))
    });
    this.queueWrite();
  }

  async flush(baseRoot: string, final: unknown): Promise<string> {
    const path = await this.start(baseRoot);
    this.queueWrite(final);
    await this.writeQueue;
    return path;
  }
}
