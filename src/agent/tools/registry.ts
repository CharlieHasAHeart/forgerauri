import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { applyPlan } from "../../generator/apply.js";
import { generateScaffold } from "../../generator/scaffold/index.js";
import type { Plan, PlanActionType } from "../../generator/types.js";
import { implementOnce } from "../../implement/implementLoop.js";
import { repairOnce } from "../../repair/repairLoop.js";
import { runCmd } from "../../runner/runCmd.js";
import { assertCommandAllowed } from "../../runtime/policy.js";
import { loadSpec } from "../../spec/loadSpec.js";
import type { ToolResult, ToolRunContext, ToolSpec } from "./types.js";

const toJsonSchema = (schema: z.ZodTypeAny): unknown => {
  const anyZ = z as unknown as { toJSONSchema?: (schema: z.ZodTypeAny) => unknown };
  if (typeof anyZ.toJSONSchema === "function") {
    return anyZ.toJSONSchema(schema);
  }
  return { type: "object", note: "json schema unavailable" };
};

const summarizePlan = (plan: Plan): Record<PlanActionType, number> => {
  const counts: Record<PlanActionType, number> = { CREATE: 0, OVERWRITE: 0, SKIP: 0, PATCH: 0 };
  plan.actions.forEach((action) => {
    counts[action.type] += 1;
  });
  return counts;
};

const relativeInside = (root: string, value: string): string => {
  const abs = isAbsolute(value) ? value : resolve(root, value);
  const rel = relative(resolve(root), abs);
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.split(sep).includes("..")) {
    throw new Error(`Path escapes root: ${value}`);
  }
  return rel.split(sep).join("/");
};

const pushTouched = (ctx: ToolRunContext, paths: string[]): void => {
  const merged = Array.from(new Set([...ctx.memory.touchedPaths, ...paths]));
  ctx.memory.touchedPaths = merged;
};

const parseTarget = (raw: string): { kind: "ui" } | { kind: "business" } | { kind: "commands"; name: string } => {
  if (raw === "ui") return { kind: "ui" };
  if (raw === "business") return { kind: "business" };
  if (raw.startsWith("commands:")) {
    const name = raw.slice("commands:".length).trim();
    if (!name) throw new Error("commands target requires a command name");
    return { kind: "commands", name };
  }
  throw new Error(`Unknown implement target: ${raw}`);
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
    let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
    try {
      entries = await readdir(current, { withFileTypes: true }) as Array<{ name: string; isDirectory: () => boolean }>;
    } catch {
      continue;
    }

    entries.forEach((entry) => {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        out.push(relative(root, full).split(sep).join("/"));
      }
    });
  }

  return out.sort((a, b) => a.localeCompare(b));
};

const tool_load_spec_input = z.object({ specPath: z.string().min(1) });
const tool_build_plan_input = z.object({
  specPath: z.string().min(1),
  outDir: z.string().min(1),
  flags: z
    .object({
      uiA: z.boolean().optional(),
      uiB: z.boolean().optional(),
      business: z.boolean().optional(),
      commands: z.boolean().optional(),
      db: z.boolean().optional(),
      scaffold: z.boolean().optional()
    })
    .optional()
});
const tool_apply_plan_input = z.object({
  outDir: z.string().min(1),
  plan: z.unknown().optional()
});
const tool_run_cmd_input = z.object({
  cwd: z.string().min(1),
  cmd: z.string().min(1),
  args: z.array(z.string())
});
const tool_repair_once_input = z.object({
  projectRoot: z.string().min(1),
  cmd: z.string().min(1),
  args: z.array(z.string())
});
const tool_implement_once_input = z.object({
  projectRoot: z.string().min(1),
  specPath: z.string().min(1),
  target: z.string().min(1),
  apply: z.boolean(),
  verify: z.boolean(),
  repair: z.boolean(),
  maxPatches: z.number().int().min(1).max(8).optional()
});
const tool_read_files_input = z.object({
  projectRoot: z.string().min(1),
  globs: z.array(z.string()).min(1),
  maxChars: z.number().int().positive().max(200000).optional()
});

const tool_load_spec: ToolSpec<z.infer<typeof tool_load_spec_input>> = {
  name: "tool_load_spec",
  description: "Load and validate spec into SpecIR.",
  inputSchema: tool_load_spec_input,
  inputJsonSchema: toJsonSchema(tool_load_spec_input),
  run: async (input, ctx) => {
    try {
      const ir = await loadSpec(input.specPath);
      ctx.memory.specPath = input.specPath;
      ctx.memory.ir = ir;
      return {
        ok: true,
        data: {
          app: ir.app,
          screens: ir.screens.length,
          commands: ir.rust_commands.map((c) => c.name)
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "LOAD_SPEC_FAILED",
          message: error instanceof Error ? error.message : "load spec failed"
        }
      };
    }
  }
};

const tool_build_plan: ToolSpec<z.infer<typeof tool_build_plan_input>> = {
  name: "tool_build_plan",
  description: "Build full deterministic plan for scaffold+db+commands+ui+business.",
  inputSchema: tool_build_plan_input,
  inputJsonSchema: toJsonSchema(tool_build_plan_input),
  run: async (input, ctx) => {
    try {
      const ir = ctx.memory.ir ?? (await loadSpec(input.specPath));
      const plan = await generateScaffold(ir, input.outDir);
      const summary = summarizePlan(plan);
      ctx.memory.ir = ir;
      ctx.memory.outDir = input.outDir;
      ctx.memory.plan = plan;
      ctx.memory.appDir = plan.appDir;
      pushTouched(ctx, plan.actions.map((action) => relativeInside(plan.appDir, action.path)).slice(0, 200));
      return {
        ok: true,
        data: {
          appDir: plan.appDir,
          summary,
          actions: plan.actions.length
        },
        meta: {
          touchedPaths: plan.actions.map((action) => action.path)
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "BUILD_PLAN_FAILED",
          message: error instanceof Error ? error.message : "build plan failed"
        }
      };
    }
  }
};

const tool_apply_plan: ToolSpec<z.infer<typeof tool_apply_plan_input>> = {
  name: "tool_apply_plan",
  description: "Apply current plan via Plan/Apply guardrails, producing patch files for user-zone changes.",
  inputSchema: tool_apply_plan_input,
  inputJsonSchema: toJsonSchema(tool_apply_plan_input),
  run: async (input, ctx) => {
    try {
      const plan = (input.plan as Plan | undefined) ?? ctx.memory.plan;
      if (!plan) {
        return {
          ok: false,
          error: {
            code: "PLAN_MISSING",
            message: "No plan in tool input or runtime memory"
          }
        };
      }

      const applied = await applyPlan(plan, { apply: ctx.flags.apply });
      const summary = summarizePlan(plan);
      ctx.memory.applySummary = {
        ...summary,
        patchPaths: applied.patchFiles,
        apply: ctx.flags.apply
      };
      if (applied.patchFiles.length > 0) {
        ctx.memory.patchPaths = Array.from(new Set([...ctx.memory.patchPaths, ...applied.patchFiles]));
      }

      return {
        ok: true,
        data: {
          apply: ctx.flags.apply,
          summary,
          patchPaths: applied.patchFiles
        },
        meta: {
          touchedPaths: plan.actions.map((action) => action.path)
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "APPLY_PLAN_FAILED",
          message: error instanceof Error ? error.message : "apply plan failed"
        }
      };
    }
  }
};

const tool_run_cmd: ToolSpec<z.infer<typeof tool_run_cmd_input>> = {
  name: "tool_run_cmd",
  description: "Run whitelisted command and capture stdout/stderr.",
  inputSchema: tool_run_cmd_input,
  inputJsonSchema: toJsonSchema(tool_run_cmd_input),
  run: async (input, ctx) => {
    try {
      assertCommandAllowed(input.cmd);
      const result = await ctx.runCmdImpl(input.cmd, input.args, input.cwd);
      if (ctx.flags.verify) {
        ctx.memory.verifyResult = result;
      }
      return {
        ok: result.ok,
        data: result,
        error: result.ok
          ? undefined
          : {
              code: "CMD_FAILED",
              message: `Command failed with code ${result.code}`,
              detail: result.stderr.slice(0, 2000)
            }
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

const tool_repair_once: ToolSpec<z.infer<typeof tool_repair_once_input>> = {
  name: "tool_repair_once",
  description: "Single repair loop: analyze failure, produce patches, apply according to zones, and rerun.",
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

      if (result.patchPaths && result.patchPaths.length > 0) {
        ctx.memory.patchPaths = Array.from(new Set([...ctx.memory.patchPaths, ...result.patchPaths]));
      }

      return {
        ok: result.ok,
        data: result,
        meta: {
          touchedPaths: result.patchPaths ?? []
        }
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

const tool_implement_once: ToolSpec<z.infer<typeof tool_implement_once_input>> = {
  name: "tool_implement_once",
  description: "LLM-driven implementation patch loop for ui/business/commands targets under zones/apply/verify guardrails.",
  inputSchema: tool_implement_once_input,
  inputJsonSchema: toJsonSchema(tool_implement_once_input),
  run: async (input, ctx) => {
    try {
      const target = parseTarget(input.target);
      const result = await implementOnce({
        projectRoot: input.projectRoot,
        specPath: input.specPath,
        target,
        maxPatches: input.maxPatches ?? ctx.flags.maxPatchesPerTurn,
        apply: input.apply,
        verify: input.verify,
        repair: input.repair,
        provider: ctx.provider,
        runImpl: ctx.runCmdImpl
      });

      if (result.patchPaths.length > 0) {
        ctx.memory.patchPaths = Array.from(new Set([...ctx.memory.patchPaths, ...result.patchPaths]));
      }
      pushTouched(ctx, result.changedPaths);

      return {
        ok: result.ok,
        data: result,
        meta: { touchedPaths: result.changedPaths }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "IMPLEMENT_FAILED",
          message: error instanceof Error ? error.message : "implement failed"
        }
      };
    }
  }
};

const tool_read_files: ToolSpec<z.infer<typeof tool_read_files_input>> = {
  name: "tool_read_files",
  description: "Read project files with glob filters for contextual analysis.",
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
      const content: Array<{ path: string; content: string; truncated: boolean }> = [];

      for (const path of picked) {
        if (used >= maxChars) break;
        const text = await readFile(join(root, path), "utf8");
        const remain = maxChars - used;
        if (text.length <= remain) {
          content.push({ path, content: text, truncated: false });
          used += text.length;
        } else {
          content.push({ path, content: `${text.slice(0, remain)}\n/* ...truncated... */\n`, truncated: true });
          used += remain;
          break;
        }
      }

      return {
        ok: true,
        data: {
          files: content,
          total: content.length,
          totalChars: used
        },
        meta: {
          touchedPaths: content.map((item) => item.path)
        }
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

export const createToolRegistry = (): Record<string, ToolSpec<any>> => {
  const tools: Array<ToolSpec<any>> = [
    tool_load_spec,
    tool_build_plan,
    tool_apply_plan,
    tool_run_cmd,
    tool_repair_once,
    tool_implement_once,
    tool_read_files
  ];

  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
};
