import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type AgentTurnAuditEntry = {
  turn: number;
  llmRaw: string;
  toolCalls: Array<{ name: string; input: unknown }>;
  toolResults: Array<{ name: string; ok: boolean; error?: string; touchedPaths?: string[] }>;
  note?: string;
};

const truncate = (value: string, max = 60000): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

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

export class AgentTurnAuditCollector {
  private readonly goal: string;
  private readonly turns: AgentTurnAuditEntry[] = [];

  constructor(goal: string) {
    this.goal = goal;
  }

  recordTurn(entry: AgentTurnAuditEntry): void {
    this.turns.push({
      ...entry,
      llmRaw: truncate(entry.llmRaw),
      toolResults: entry.toolResults.map((result) => ({
        ...result,
        error: result.error ? truncate(result.error, 8000) : undefined,
        touchedPaths: result.touchedPaths?.slice(0, 200)
      }))
    });
  }

  async flush(baseRoot: string, final: unknown): Promise<string> {
    const dir = join(baseRoot, "generated/agent_logs");
    await mkdir(dir, { recursive: true });
    const counter = await nextCounter(dir);
    const path = join(dir, `${String(counter).padStart(4, "0")}.json`);

    const payload = {
      goal: this.goal,
      turns: this.turns,
      final
    };

    await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
    return path;
  }
}
