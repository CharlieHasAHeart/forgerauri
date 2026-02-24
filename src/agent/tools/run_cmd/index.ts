import { z } from "zod";
import { assertCommandAllowed } from "../../../runtime/policy.js";
import type { ToolPackage } from "../types.js";

const inputSchema = z.object({
  cwd: z.string().min(1),
  cmd: z.string().min(1),
  args: z.array(z.string())
});

const outputSchema = z.object({
  ok: z.boolean(),
  code: z.number(),
  stdout: z.string(),
  stderr: z.string()
});

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_run_cmd",
    version: "1.0.0",
    category: "low",
    description: "Low-level command runner with whitelist enforcement.",
    capabilities: ["exec", "diagnostics"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "exec",
      allowlist: ["pnpm", "cargo", "tauri", "node"]
    }
  },
  runtime: {
    run: async (input, ctx) => {
      try {
        assertCommandAllowed(input.cmd);
        const result = await ctx.runCmdImpl(input.cmd, input.args, input.cwd);
        return {
          ok: result.ok,
          data: result,
          error: result.ok
            ? undefined
            : {
                code: "CMD_FAILED",
                message: `Command failed with code ${result.code}`,
                detail: result.stderr.slice(0, 3000)
              },
          meta: { touchedPaths: [input.cwd] }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "RUN_CMD_FAILED",
            message: error instanceof Error ? error.message : "run cmd failed"
          }
        };
      }
    },
    examples: [
      {
        title: "Run cargo check",
        toolCall: { name: "tool_run_cmd", input: { cwd: "./generated/app/src-tauri", cmd: "cargo", args: ["check"] } },
        expected: "Returns stdout/stderr and exit status."
      }
    ]
  }
};
