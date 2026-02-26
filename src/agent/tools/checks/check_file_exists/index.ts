import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { ToolPackage } from "../../types.js";

const inputSchema = z.object({
  base: z.enum(["appDir", "outDir"]),
  path: z.string().min(1)
});

const outputSchema = z.object({
  ok: z.boolean(),
  exists: z.boolean(),
  absolutePath: z.string()
});

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_check_file_exists",
    version: "1.0.0",
    category: "low",
    description: "Check whether a file exists under appDir/outDir.",
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
      const exists = existsSync(absolutePath);
      return {
        ok: exists,
        data: { ok: exists, exists, absolutePath },
        error: exists ? undefined : { code: "FILE_NOT_FOUND", message: `${input.path} does not exist` },
        meta: { touchedPaths: [] }
      };
    },
    examples: [
      {
        title: "Check generated file",
        toolCall: { name: "tool_check_file_exists", input: { base: "appDir", path: "src/App.svelte" } },
        expected: "Returns ok=true when file exists"
      }
    ]
  }
};
