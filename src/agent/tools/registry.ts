import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { repairOnce } from "../../repair/repairLoop.js";
import { assertCommandAllowed } from "../../runtime/policy.js";
import { bootstrapProjectInputSchema, runBootstrapProject } from "./bootstrapProject.js";
import { verifyProjectInputSchema, runVerifyProject } from "./verifyProject.js";
import type { ToolRunContext, ToolSpec } from "./types.js";

const toJsonSchema = (schema: z.ZodTypeAny): unknown => {
  const anyZ = z as unknown as { toJSONSchema?: (s: z.ZodTypeAny) => unknown };
  if (typeof anyZ.toJSONSchema === "function") return anyZ.toJSONSchema(schema);
  return { type: "object" };
};

const globToRegex = (glob: string): RegExp => {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*");
  return new RegExp(`^${escaped}$`);
};

const listFiles = async (root: string): Promise<string[]> => {
  const stack = [root];
  const out: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    try {
      const entries = await readdir(current, { withFileTypes: true });
      entries.forEach((entry) => {
        const full = join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else out.push(full.replace(`${root}/`, "").replace(/\\/g, "/"));
      });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
};

const tool_bootstrap_project: ToolSpec<z.infer<typeof bootstrapProjectInputSchema>> = {
  name: "tool_bootstrap_project",
  description: "High-level bootstrap: load spec, mandatory llm enrich, build plan, apply plan.",
  inputSchema: bootstrapProjectInputSchema,
  inputJsonSchema: toJsonSchema(bootstrapProjectInputSchema),
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
  }
};

const tool_verify_project: ToolSpec<z.infer<typeof verifyProjectInputSchema>> = {
  name: "tool_verify_project",
  description: "High-level verify gate with fixed order and optional full tauri build gate.",
  inputSchema: verifyProjectInputSchema,
  inputJsonSchema: toJsonSchema(verifyProjectInputSchema),
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
  }
};

const tool_run_cmd_input = z.object({ cwd: z.string().min(1), cmd: z.string().min(1), args: z.array(z.string()) });
const tool_run_cmd: ToolSpec<z.infer<typeof tool_run_cmd_input>> = {
  name: "tool_run_cmd",
  description: "Low-level command runner with whitelist enforcement.",
  inputSchema: tool_run_cmd_input,
  inputJsonSchema: toJsonSchema(tool_run_cmd_input),
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
  }
};

const tool_repair_once_input = z.object({
  projectRoot: z.string().min(1),
  cmd: z.string().min(1),
  args: z.array(z.string())
});

const tool_repair_once: ToolSpec<z.infer<typeof tool_repair_once_input>> = {
  name: "tool_repair_once",
  description: "Single repair loop against a failed command.",
  inputSchema: tool_repair_once_input,
  inputJsonSchema: toJsonSchema(tool_repair_once_input),
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
  }
};

const tool_read_files_input = z.object({
  projectRoot: z.string().min(1),
  globs: z.array(z.string()).min(1),
  maxChars: z.number().int().positive().max(200000).optional()
});

const tool_read_files: ToolSpec<z.infer<typeof tool_read_files_input>> = {
  name: "tool_read_files",
  description: "Read project files using glob patterns for additional context.",
  inputSchema: tool_read_files_input,
  inputJsonSchema: toJsonSchema(tool_read_files_input),
  run: async (input) => {
    try {
      const root = resolve(input.projectRoot);
      const files = await listFiles(root);
      const regexes = input.globs.map(globToRegex);
      const picked = files.filter((path) => regexes.some((regex) => regex.test(path)));

      const maxChars = input.maxChars ?? 100000;
      let used = 0;
      const out: Array<{ path: string; content: string; truncated: boolean }> = [];

      for (const rel of picked) {
        if (used >= maxChars) break;
        const text = await readFile(join(root, rel), "utf8");
        const remain = maxChars - used;
        if (text.length <= remain) {
          out.push({ path: rel, content: text, truncated: false });
          used += text.length;
        } else {
          out.push({ path: rel, content: `${text.slice(0, remain)}\n/* ...truncated... */\n`, truncated: true });
          used += remain;
          break;
        }
      }

      return {
        ok: true,
        data: { files: out, total: out.length, totalChars: used },
        meta: { touchedPaths: out.map((item) => item.path) }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "READ_FILES_FAILED",
          message: error instanceof Error ? error.message : "read files failed"
        }
      };
    }
  }
};

export const createToolRegistry = (deps?: {
  runBootstrapProjectImpl?: typeof runBootstrapProject;
  runVerifyProjectImpl?: typeof runVerifyProject;
  repairOnceImpl?: typeof repairOnce;
}): Record<string, ToolSpec<any>> => {
  const runBootstrap = deps?.runBootstrapProjectImpl ?? runBootstrapProject;
  const runVerify = deps?.runVerifyProjectImpl ?? runVerifyProject;
  const runRepair = deps?.repairOnceImpl ?? repairOnce;

  const wrappedToolBootstrap: ToolSpec<any> = {
    ...tool_bootstrap_project,
    run: async (input, ctx) => {
      try {
        const result = await runBootstrap({
          specPath: input.specPath,
          outDir: input.outDir,
          apply: input.apply,
          provider: ctx.provider
        });
        ctx.memory.specPath = input.specPath;
        ctx.memory.outDir = input.outDir;
        ctx.memory.appDir = result.appDir;
        ctx.memory.patchPaths = Array.from(new Set([...ctx.memory.patchPaths, ...result.applySummary.patchPaths]));
        return { ok: true, data: result, meta: { touchedPaths: [result.appDir, ...result.applySummary.patchPaths] } };
      } catch (error) {
        return {
          ok: false,
          error: { code: "BOOTSTRAP_FAILED", message: error instanceof Error ? error.message : "bootstrap failed" }
        };
      }
    }
  };

  const wrappedToolVerify: ToolSpec<any> = {
    ...tool_verify_project,
    run: async (input, ctx) => {
      try {
        const result = await runVerify({
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
          error: result.ok ? undefined : { code: "VERIFY_FAILED", message: result.summary, detail: result.suggestion },
          meta: { touchedPaths: [input.projectRoot] }
        };
      } catch (error) {
        return {
          ok: false,
          error: { code: "VERIFY_FAILED", message: error instanceof Error ? error.message : "verify failed" }
        };
      }
    }
  };

  const wrappedToolRepair: ToolSpec<any> = {
    ...tool_repair_once,
    run: async (input, ctx) => {
      try {
        const result = await runRepair({
          projectRoot: input.projectRoot,
          cmd: input.cmd,
          args: input.args,
          provider: ctx.provider,
          apply: ctx.flags.apply,
          budget: { maxPatches: ctx.flags.maxPatchesPerTurn },
          runImpl: ctx.runCmdImpl
        });
        ctx.memory.patchPaths = Array.from(new Set([...ctx.memory.patchPaths, ...(result.patchPaths ?? [])]));
        return { ok: result.ok, data: result, meta: { touchedPaths: result.patchPaths ?? [] } };
      } catch (error) {
        return {
          ok: false,
          error: { code: "REPAIR_FAILED", message: error instanceof Error ? error.message : "repair failed" }
        };
      }
    }
  };

  const tools: Array<ToolSpec<any>> = [
    wrappedToolBootstrap,
    wrappedToolVerify,
    wrappedToolRepair,
    tool_run_cmd,
    tool_read_files
  ];

  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
};
