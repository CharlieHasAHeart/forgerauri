import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const walkTsFiles = (root: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkTsFiles(full));
      continue;
    }
    if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
};

describe("no legacy imports", () => {
  test("runtime does not import legacy modules", () => {
    const runtimeFiles = walkTsFiles(join(process.cwd(), "src/agent/runtime"));
    const offenders: string[] = [];
    for (const file of runtimeFiles) {
      const content = readFileSync(file, "utf8");
      if (content.includes("/legacy/") || content.includes("from \"../legacy")) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
