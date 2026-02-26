import { createHash } from "node:crypto";
import type { ToolSpec } from "../tools/types.js";

const stableStringify = (value: unknown): string => {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      const obj = input as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(obj)
          .sort((a, b) => a.localeCompare(b))
          .map((key) => [key, normalize(obj[key])])
      );
    }
    return input;
  };

  return JSON.stringify(normalize(value));
};

const schemaFingerprint = (schema: unknown): string => {
  const digest = createHash("sha256").update(stableStringify(schema)).digest("hex");
  return `sha256:${digest.slice(0, 16)}`;
};

export const renderToolIndex = (registry: Record<string, ToolSpec>): string => {
  const rows = Object.values(registry)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tool) => ({
      name: tool.name,
      category: tool.category,
      summary: tool.description,
      safety: tool.safety,
      input_schema_fingerprint: schemaFingerprint(tool.inputJsonSchema)
    }));
  return JSON.stringify(rows, null, 2);
};
