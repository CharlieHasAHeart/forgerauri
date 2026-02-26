import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { ToolPackage } from "../types.js";

const inputSchema = z.object({
  base: z.enum(["appDir", "outDir"]),
  path: z.string().min(1),
  contains: z.string().min(1)
});

const outputSchema = z.object({
  ok: z.boolean(),
  absolutePath: z.string(),
  found: z.boolean()
});

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_check_file_contains",
    version: "1.0.0",
    category: "low",
    description: "Check whether a file contains a target substring.",
    capabilities: ["check", "file"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "none"
    }
  },
  runtime: {
    run: async (input, ctx) => {
      const baseRoot = input.base === "appDir" ? ctx.memory.appDir : ctx.memory.outDir;
      if (!baseRoot) {
        return {
          ok: false,
          error: { code: "CHECK_BASE_MISSING", message: `Base root '${input.base}' is not available` },
          meta: { touchedPaths: [] }
        };
      }

      const absolutePath = resolve(baseRoot, input.path);
      if (!existsSync(absolutePath)) {
        return {
          ok: false,
          error: { code: "FILE_NOT_FOUND", message: `${input.path} does not exist` },
          meta: { touchedPaths: [] }
        };
      }

      const content = readFileSync(absolutePath, "utf8");
      const found = content.includes(input.contains);
      return {
        ok: found,
        data: { ok: found, absolutePath, found },
        error: found ? undefined : { code: "TEXT_NOT_FOUND", message: `Expected text not found in ${input.path}` },
        meta: { touchedPaths: [] }
      };
    },
    examples: [
      {
        title: "Check file content",
        toolCall: { name: "tool_check_file_contains", input: { base: "appDir", path: "README.md", contains: "Tauri" } },
        expected: "Returns ok=true when text is present"
      }
    ]
  }
};
