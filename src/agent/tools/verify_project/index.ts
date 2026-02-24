import { z } from "zod";
import { runVerifyProject, verifyProjectInputSchema } from "../verifyProject.js";
import type { ToolPackage } from "../types.js";

const verifyStepSchema = z.object({
  name: z.enum(["install", "install_retry", "build", "build_retry", "cargo_check", "tauri_check", "tauri_build"]),
  ok: z.boolean(),
  code: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  skipped: z.boolean().optional()
});

const outputSchema = z.object({
  ok: z.boolean(),
  step: z.enum(["install", "install_retry", "build", "build_retry", "cargo_check", "tauri_check", "tauri_build", "none"]),
  results: z.array(verifyStepSchema),
  summary: z.string(),
  classifiedError: z.enum(["Deps", "TS", "Rust", "Tauri", "Config", "Unknown"]),
  suggestion: z.string()
});

export const toolPackage: ToolPackage<z.infer<typeof verifyProjectInputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_verify_project",
    version: "1.0.0",
    category: "high",
    description: "High-level verify gate with fixed order and optional full tauri build gate.",
    capabilities: ["verify", "build", "cargo", "tauri"],
    inputSchema: verifyProjectInputSchema,
    outputSchema,
    safety: {
      sideEffects: "exec",
      allowlist: ["pnpm", "cargo", "tauri", "node"]
    }
  },
  runtime: {
    run: async (input, ctx) => {
      try {
        const result = await runVerifyProject({
          projectRoot: input.projectRoot,
          verifyLevel: input.verifyLevel,
          runCmdImpl: ctx.runCmdImpl
        });
        ctx.memory.verifyResult = {
          ok: result.ok,
          code: result.ok ? 0 : 1,
          stdout: result.results.map((r) => `[${r.name}] ${r.stdout}`).join("\n"),
          stderr: result.results.map((r) => `[${r.name}] ${r.stderr}`).join("\n")
        };
        return {
          ok: result.ok,
          data: result,
          error: result.ok
            ? undefined
            : {
                code: "VERIFY_FAILED",
                message: result.summary,
                detail: result.suggestion
              },
          meta: { touchedPaths: [input.projectRoot] }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "VERIFY_FAILED",
            message: error instanceof Error ? error.message : "verify failed"
          }
        };
      }
    },
    examples: [
      {
        title: "Basic verify",
        toolCall: { name: "tool_verify_project", input: { projectRoot: "./generated/app", verifyLevel: "basic" } },
        expected: "Runs install/build/cargo_check/tauri_check and returns structured step results."
      },
      {
        title: "Full verify",
        toolCall: { name: "tool_verify_project", input: { projectRoot: "./generated/app", verifyLevel: "full" } },
        expected: "Includes tauri_build gate after cargo_check."
      }
    ]
  }
};
