import { repairOnce } from "../../repair/repairLoop.js";
import { runBootstrapProject } from "./bootstrapProject.js";
import { runCodegenFromDesign } from "./codegen_from_design/index.js";
import { runDesignContract } from "./design_contract/index.js";
import { runDesignDelivery } from "./design_delivery/index.js";
import { runDesignImplementation } from "./design_implementation/index.js";
import { runDesignUx } from "./design_ux/index.js";
import { buildToolDocPack, loadToolPackages } from "./loader.js";
import { runMaterializeContract } from "./materialize_contract/index.js";
import { runMaterializeDelivery } from "./materialize_delivery/index.js";
import { runMaterializeImplementation } from "./materialize_implementation/index.js";
import { runMaterializeUx } from "./materialize_ux/index.js";
import { runVerifyProject } from "./verifyProject.js";
import type { ToolDocPack, ToolRunContext, ToolSpec } from "./types.js";
import { wrapToolRunWithOutputValidation } from "./util.js";

export type ToolRegistryDeps = {
  runBootstrapProjectImpl?: typeof runBootstrapProject;
  runDesignContractImpl?: typeof runDesignContract;
  runMaterializeContractImpl?: typeof runMaterializeContract;
  runDesignUxImpl?: typeof runDesignUx;
  runMaterializeUxImpl?: typeof runMaterializeUx;
  runDesignImplementationImpl?: typeof runDesignImplementation;
  runMaterializeImplementationImpl?: typeof runMaterializeImplementation;
  runDesignDeliveryImpl?: typeof runDesignDelivery;
  runMaterializeDeliveryImpl?: typeof runMaterializeDelivery;
  runCodegenFromDesignImpl?: typeof runCodegenFromDesign;
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
  run: wrapToolRunWithOutputValidation(tool, async (input, ctx) => run(input, ctx))
});

export const createToolRegistry = async (deps?: ToolRegistryDeps): Promise<Record<string, ToolSpec<any>>> => {
  const loaded = await loadToolPackages(deps?.toolsBaseDir);

  // Override only when tests inject custom impl. In normal runtime,
  // keep toolPackage.runtime.run from discovery loader unchanged.
  if (deps?.runBootstrapProjectImpl && loaded.tool_bootstrap_project) {
    loaded.tool_bootstrap_project = withRunOverride(loaded.tool_bootstrap_project, async (input, ctx) => {
      try {
        const result = await deps.runBootstrapProjectImpl!({
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

  if (deps?.runVerifyProjectImpl && loaded.tool_verify_project) {
    loaded.tool_verify_project = withRunOverride(loaded.tool_verify_project, async (input, ctx) => {
      try {
        const result = await deps.runVerifyProjectImpl!({
          projectRoot: input.projectRoot,
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

  if (deps?.runDesignContractImpl && loaded.tool_design_contract) {
    loaded.tool_design_contract = withRunOverride(loaded.tool_design_contract, async (input, ctx) => {
      try {
        const result = await deps.runDesignContractImpl!({
          goal: input.goal,
          specPath: input.specPath,
          rawSpec: input.rawSpec,
          projectRoot: input.projectRoot,
          provider: ctx.provider
        });
        return { ok: true, data: { contract: result.contract, attempts: result.attempts }, meta: { touchedPaths: [] } };
      } catch (error) {
        return {
          ok: false,
          error: { code: "DESIGN_CONTRACT_FAILED", message: error instanceof Error ? error.message : "contract design failed" }
        };
      }
    });
  }

  if (deps?.runMaterializeContractImpl && loaded.tool_materialize_contract) {
    loaded.tool_materialize_contract = withRunOverride(loaded.tool_materialize_contract, async (input) => {
      try {
        const result = await deps.runMaterializeContractImpl!({
          contract: input.contract,
          outDir: input.outDir,
          appDir: input.appDir,
          appNameHint: input.appNameHint,
          apply: input.apply
        });
        return {
          ok: true,
          data: result,
          meta: {
            touchedPaths: [
              result.contractPath,
              `${result.appDir}/src/lib/contract/contract.json`,
              `${result.appDir}/src-tauri/migrations/0004_contract.sql`
            ]
          }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "MATERIALIZE_CONTRACT_FAILED",
            message: error instanceof Error ? error.message : "contract materialization failed"
          }
        };
      }
    });
  }

  if (deps?.runDesignUxImpl && loaded.tool_design_ux) {
    loaded.tool_design_ux = withRunOverride(loaded.tool_design_ux, async (input, ctx) => {
      try {
        const result = await deps.runDesignUxImpl!({
          goal: input.goal,
          specPath: input.specPath,
          contract: input.contract,
          projectRoot: input.projectRoot,
          provider: ctx.provider
        });
        return { ok: true, data: { ux: result.ux, attempts: result.attempts }, meta: { touchedPaths: [] } };
      } catch (error) {
        return {
          ok: false,
          error: { code: "DESIGN_UX_FAILED", message: error instanceof Error ? error.message : "ux design failed" }
        };
      }
    });
  }

  if (deps?.runMaterializeUxImpl && loaded.tool_materialize_ux) {
    loaded.tool_materialize_ux = withRunOverride(loaded.tool_materialize_ux, async (input) => {
      try {
        const result = await deps.runMaterializeUxImpl!({ ux: input.ux, projectRoot: input.projectRoot, apply: input.apply });
        return { ok: true, data: result, meta: { touchedPaths: [result.uxPath, `${input.projectRoot}/src/lib/design/ux.ts`] } };
      } catch (error) {
        return {
          ok: false,
          error: { code: "MATERIALIZE_UX_FAILED", message: error instanceof Error ? error.message : "ux materialization failed" }
        };
      }
    });
  }

  if (deps?.runDesignImplementationImpl && loaded.tool_design_implementation) {
    loaded.tool_design_implementation = withRunOverride(loaded.tool_design_implementation, async (input, ctx) => {
      try {
        const result = await deps.runDesignImplementationImpl!({
          goal: input.goal,
          contract: input.contract,
          ux: input.ux,
          projectRoot: input.projectRoot,
          provider: ctx.provider
        });
        return { ok: true, data: { impl: result.impl, attempts: result.attempts }, meta: { touchedPaths: [] } };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "DESIGN_IMPLEMENTATION_FAILED",
            message: error instanceof Error ? error.message : "implementation design failed"
          }
        };
      }
    });
  }

  if (deps?.runMaterializeImplementationImpl && loaded.tool_materialize_implementation) {
    loaded.tool_materialize_implementation = withRunOverride(loaded.tool_materialize_implementation, async (input) => {
      try {
        const result = await deps.runMaterializeImplementationImpl!({
          impl: input.impl,
          projectRoot: input.projectRoot,
          apply: input.apply
        });
        return {
          ok: true,
          data: result,
          meta: { touchedPaths: [result.implPath, `${input.projectRoot}/src/lib/design/implementation.ts`] }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "MATERIALIZE_IMPLEMENTATION_FAILED",
            message: error instanceof Error ? error.message : "implementation materialization failed"
          }
        };
      }
    });
  }

  if (deps?.runDesignDeliveryImpl && loaded.tool_design_delivery) {
    loaded.tool_design_delivery = withRunOverride(loaded.tool_design_delivery, async (input, ctx) => {
      try {
        const result = await deps.runDesignDeliveryImpl!({
          goal: input.goal,
          contract: input.contract,
          projectRoot: input.projectRoot,
          provider: ctx.provider
        });
        return { ok: true, data: { delivery: result.delivery, attempts: result.attempts }, meta: { touchedPaths: [] } };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "DESIGN_DELIVERY_FAILED",
            message: error instanceof Error ? error.message : "delivery design failed"
          }
        };
      }
    });
  }

  if (deps?.runMaterializeDeliveryImpl && loaded.tool_materialize_delivery) {
    loaded.tool_materialize_delivery = withRunOverride(loaded.tool_materialize_delivery, async (input) => {
      try {
        const result = await deps.runMaterializeDeliveryImpl!({
          delivery: input.delivery,
          projectRoot: input.projectRoot,
          apply: input.apply
        });
        return {
          ok: true,
          data: result,
          meta: {
            touchedPaths: [
              result.deliveryPath,
              `${input.projectRoot}/src/lib/design/delivery.ts`,
              `${input.projectRoot}/scripts/preflight.sh`,
              `${input.projectRoot}/src-tauri/icons/icon.png`
            ]
          }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "MATERIALIZE_DELIVERY_FAILED",
            message: error instanceof Error ? error.message : "delivery materialization failed"
          }
        };
      }
    });
  }

  if (deps?.runCodegenFromDesignImpl && loaded.tool_codegen_from_design) {
    loaded.tool_codegen_from_design = withRunOverride(loaded.tool_codegen_from_design, async (input) => {
      try {
        const result = await deps.runCodegenFromDesignImpl!({
          projectRoot: input.projectRoot,
          apply: input.apply
        });
        return {
          ok: true,
          data: result,
          meta: {
            touchedPaths: result.generated.map((relativePath) => `${input.projectRoot}/${relativePath}`)
          }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "CODEGEN_FROM_DESIGN_FAILED",
            message: error instanceof Error ? error.message : "codegen from design failed"
          }
        };
      }
    });
  }

  if (deps?.repairOnceImpl && loaded.tool_repair_once) {
    loaded.tool_repair_once = withRunOverride(loaded.tool_repair_once, async (input, ctx) => {
      try {
        const result = await deps.repairOnceImpl!({
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
