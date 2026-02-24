import { z } from "zod";
import { runBootstrapProject } from "../bootstrapProject.js";
import type { ToolPackage } from "../types.js";

const outputSchema = z.object({
  ok: z.boolean(),
  appDir: z.string(),
  usedLLM: z.boolean(),
  planSummary: z.object({ create: z.number(), overwrite: z.number(), skip: z.number(), patch: z.number() }),
  applySummary: z.object({
    create: z.number(),
    overwrite: z.number(),
    skip: z.number(),
    patch: z.number(),
    patchPaths: z.array(z.string()),
    applied: z.boolean()
  })
});

const inputSchema = z.object({
  specPath: z.string().min(1),
  outDir: z.string().min(1),
  apply: z.boolean().default(true)
});

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_bootstrap_project",
    version: "1.0.0",
    category: "high",
    description: "High-level bootstrap: load spec, mandatory llm enrich, build plan, apply plan.",
    capabilities: ["bootstrap", "spec", "plan", "apply"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "fs"
    }
  },
  runtime: {
    run: async (input, ctx) => {
      try {
        const result = await runBootstrapProject({
          specPath: input.specPath,
          outDir: input.outDir,
          apply: input.apply,
          provider: ctx.provider
        });

        ctx.memory.specPath = input.specPath;
        ctx.memory.outDir = input.outDir;
        ctx.memory.appDir = result.appDir;
        ctx.memory.patchPaths = Array.from(new Set([...ctx.memory.patchPaths, ...result.applySummary.patchPaths]));

        return {
          ok: true,
          data: result,
          meta: { touchedPaths: [result.appDir, ...result.applySummary.patchPaths] }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "BOOTSTRAP_FAILED",
            message: error instanceof Error ? error.message : "bootstrap failed"
          }
        };
      }
    },
    examples: [
      {
        title: "Bootstrap in apply mode",
        toolCall: { name: "tool_bootstrap_project", input: { specPath: "/tmp/spec.json", outDir: "./generated", apply: true } },
        expected: "Returns appDir and plan/apply summaries."
      }
    ]
  }
};
