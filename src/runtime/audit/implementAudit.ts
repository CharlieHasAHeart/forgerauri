import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nextJsonCounter } from "./counter.js";

export class ImplementAuditCollector {
  async write(projectRoot: string, payload: unknown): Promise<string> {
    const dir = join(projectRoot, "generated/llm_logs");
    await mkdir(dir, { recursive: true });
    const counter = await nextJsonCounter(dir);
    const path = join(dir, `${String(counter).padStart(4, "0")}.json`);
    await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
    return path;
  }
}
