import { repairOnce } from "../../repair/repairLoop.js";
import { runBootstrapProject } from "./bootstrapProject.js";
import { loadToolPackages, buildToolDocPack } from "./loader.js";
import { runVerifyProject } from "./verifyProject.js";
import type { ToolDocPack, ToolRunContext, ToolSpec } from "./types.js";

export type ToolRegistryDeps = {
  runBootstrapProjectImpl?: typeof runBootstrapProject;
  runVerifyProjectImpl?: typeof runVerifyProject;
  repairOnceImpl?: typeof repairOnce;
  toolsBaseDir?: string;
};

export type ToolRegistryLoadResult = {
  registry: Record<string, ToolSpec<any>>;
  docs: ToolDocPack[];
};

const withRunOverride = (
  tool: ToolSpec<any>,
  run: (input: any, ctx: ToolRunContext) => ReturnType<ToolSpec<any>["run"]>
): ToolSpec<any> => ({
  ...tool,
  run
});

export const createToolRegistry = async (deps?: ToolRegistryDeps): Promise<Record<string, ToolSpec<any>>> => {
  const loaded = await loadToolPackages(deps?.toolsBaseDir);
  const runBootstrap = deps?.runBootstrapProjectImpl ?? runBootstrapProject;
  const runVerify = deps?.runVerifyProjectImpl ?? runVerifyProject;
  const runRepair = deps?.repairOnceImpl ?? repairOnce;

  if (loaded.tool_bootstrap_project) {
    loaded.tool_bootstrap_project = withRunOverride(loaded.tool_bootstrap_project, async (input, ctx) => {
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
    });
  }

  if (loaded.tool_verify_project) {
    loaded.tool_verify_project = withRunOverride(loaded.tool_verify_project, async (input, ctx) => {
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
    });
  }

  if (loaded.tool_repair_once) {
    loaded.tool_repair_once = withRunOverride(loaded.tool_repair_once, async (input, ctx) => {
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
    });
  }

  return loaded;
};

export const loadToolRegistryWithDocs = async (deps?: ToolRegistryDeps): Promise<ToolRegistryLoadResult> => {
  const registry = await createToolRegistry(deps);
  return {
    registry,
    docs: buildToolDocPack(registry)
  };
};
