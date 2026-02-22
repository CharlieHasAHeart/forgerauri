import { readFile } from "node:fs/promises";
import { specSchema, type SpecIR } from "./schema.js";

export const loadSpec = async (specPath: string): Promise<SpecIR> => {
  const rawText = await readFile(specPath, "utf8");
  const rawJson = JSON.parse(rawText) as unknown;
  const parsed = specSchema.parse(rawJson);

  return {
    ...parsed,
    raw: rawJson
  };
};
