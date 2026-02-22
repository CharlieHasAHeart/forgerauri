import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const parseLine = (line: string): { key: string; value: string } | null => {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) return null;

  const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const idx = withoutExport.indexOf("=");
  if (idx <= 0) return null;

  const key = withoutExport.slice(0, idx).trim();
  let value = withoutExport.slice(idx + 1).trim();

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  return { key, value };
};

export const loadEnvFile = (filePath = ".env"): void => {
  const absolute = resolve(process.cwd(), filePath);
  if (!existsSync(absolute)) return;

  const content = readFileSync(absolute, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const parsed = parseLine(line);
    if (!parsed) return;
    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  });
};
