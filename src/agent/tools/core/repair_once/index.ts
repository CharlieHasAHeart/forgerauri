import { z } from "zod";
import { repairOnce } from "../../../workflows/repair/repairLoop.js";
import type { ToolPackage } from "../../types.js";

const inputSchema = z.object({
  projectRoot: z.string().min(1),
  cmd: z.string().min(1),
  args: z.array(z.string())
});

const outputSchema = z.object({
  ok: z.boolean(),
  summary: z.string(),
  patchPaths: z.array(z.string()).optional()
});

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_repair_once",
    version: "1.0.0",
    category: "high",
    description: "Single repair loop against a failed command.",
    capabilities: ["repair", "patch", "llm"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "llm"
    }
  },
  runtime: {
    run: async (input, ctx) => {
      try {
        const result = await repairOnce({
          projectRoot: input.projectRoot,
          cmd: input.cmd,
          args: input.args,
          provider: ctx.provider,
          apply: ctx.flags.apply,
          budget: { maxPatches: ctx.flags.maxPatchesPerTurn },
          runImpl: ctx.runCmdImpl
        });

        ctx.memory.patchPaths = Array.from(new Set([...ctx.memory.patchPaths, ...(result.patchPaths ?? [])]));
        return {
          ok: result.ok,
          data: result,
          meta: { touchedPaths: result.patchPaths ?? [] }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "REPAIR_FAILED",
            message: error instanceof Error ? error.message : "repair failed"
          }
        };
      }
    },
    examples: [
      {
        title: "Repair build command",
        toolCall: { name: "tool_repair_once", input: { projectRoot: "./generated/app", cmd: "pnpm", args: ["-C", "./generated/app", "build"] } },
        expected: "Returns patchPaths and a repair summary."
      }
    ]
  }
};
