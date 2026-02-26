import { z } from "zod";
import type { ToolPackage } from "../../types.js";

const inputSchema = z.object({
  cmd: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  expect_exit_code: z.number().int().default(0)
});

const outputSchema = z.object({
  ok: z.boolean(),
  code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  cwd: z.string()
});

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_check_command",
    version: "1.0.0",
    category: "low",
    description: "Run a command and assert expected exit code.",
    capabilities: ["check", "command", "exec"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "exec",
      allowlist: ["pnpm", "cargo", "node", "tauri"]
    }
  },
  runtime: {
    run: async (input, ctx) => {
      const cwd = input.cwd ?? ctx.memory.appDir ?? ctx.memory.outDir ?? process.cwd();
      const out = await ctx.runCmdImpl(input.cmd, input.args, cwd);
      const ok = out.code === input.expect_exit_code;
      return {
        ok,
        data: {
          ok,
          code: out.code,
          stdout: out.stdout,
          stderr: out.stderr,
          cwd
        },
        error: ok ? undefined : { code: "COMMAND_CHECK_FAILED", message: `${input.cmd} exited with ${out.code}` },
        meta: { touchedPaths: [] }
      };
    },
    examples: [
      {
        title: "Check build command",
        toolCall: { name: "tool_check_command", input: { cmd: "pnpm", args: ["-C", "./generated/app", "build"], expect_exit_code: 0 } },
        expected: "Returns ok=true when command exits 0"
      }
    ]
  }
};
