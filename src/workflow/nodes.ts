import { readFile } from "node:fs/promises";
import { applyPlan } from "../generator/apply.js";
import type { Plan, PlanActionType } from "../generator/types.js";
import { getProviderFromEnv } from "../llm/index.js";
import { repairOnce } from "../repair/repairLoop.js";
import { runCmd } from "../runner/runCmd.js";
import { enrichWireSpecWithLLM } from "../spec/enrichWithLLM.js";
import { parseSpecFromRaw } from "../spec/loadSpec.js";
import { generateScaffold } from "../generator/scaffold/index.js";
import type { ApplySummary, PlanSummary, VerifyResult, WorkflowState } from "./state.js";

const countsFromPlan = (plan: Plan): Record<PlanActionType, number> => {
  const counts: Record<PlanActionType, number> = {
    CREATE: 0,
    OVERWRITE: 0,
    SKIP: 0,
    PATCH: 0
  };

  plan.actions.forEach((action) => {
    counts[action.type] += 1;
  });

  return counts;
};

const toPlanSummary = (plan: Plan): PlanSummary => {
  const counts = countsFromPlan(plan);
  return {
    create: counts.CREATE,
    overwrite: counts.OVERWRITE,
    skip: counts.SKIP,
    patch: counts.PATCH
  };
};

const toApplySummary = (plan: Plan, patchPaths: string[]): ApplySummary => {
  const counts = countsFromPlan(plan);
  return {
    create: counts.CREATE,
    overwrite: counts.OVERWRITE,
    skip: counts.SKIP,
    patch: counts.PATCH,
    patchPaths
  };
};

const appendAudit = (state: WorkflowState, node: string, ok: boolean, note?: string): WorkflowState["audit"] => [
  ...state.audit,
  { node, ok, note }
];

const appendError = (state: WorkflowState, message: string): WorkflowState["errors"] => [...state.errors, message];

export const node_load_spec = async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
  try {
    const rawText = await readFile(state.specPath, "utf8");
    const wireSpec = JSON.parse(rawText) as unknown;
    const ir = parseSpecFromRaw(wireSpec);
    return {
      wireSpec,
      ir,
      audit: appendAudit(state, "load_spec", true, "spec parsed")
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "load_spec failed";
    return {
      audit: appendAudit(state, "load_spec", false, message),
      errors: appendError(state, message)
    };
  }
};

export const node_llm_enrich_spec = async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
  if (!state.flags.llmEnrich) {
    return {
      audit: appendAudit(state, "llm_enrich_spec", true, "skipped")
    };
  }

  try {
    if (state.wireSpec == null) {
      throw new Error("wire spec missing in state");
    }

    const provider = getProviderFromEnv();
    const enriched = await enrichWireSpecWithLLM({ wire: state.wireSpec, provider });
    const ir = parseSpecFromRaw(enriched.wireEnriched);

    return {
      wireSpec: enriched.wireEnriched,
      ir,
      usedLLM: enriched.used,
      audit: appendAudit(state, "llm_enrich_spec", true, `used=${String(enriched.used)}`)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "llm_enrich_spec failed";
    return {
      usedLLM: false,
      audit: appendAudit(state, "llm_enrich_spec", false, message),
      errors: appendError(state, message)
    };
  }
};

export const node_build_plan = async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
  try {
    if (!state.ir) {
      throw new Error("IR missing; cannot build plan");
    }

    const plan = await generateScaffold(state.ir, state.outDir);
    return {
      plan,
      planSummary: toPlanSummary(plan),
      audit: appendAudit(state, "build_plan", true, `actions=${String(plan.actions.length)}`)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "build_plan failed";
    return {
      audit: appendAudit(state, "build_plan", false, message),
      errors: appendError(state, message)
    };
  }
};

export const node_apply_plan = async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
  if (!state.flags.apply) {
    return {
      audit: appendAudit(state, "apply_plan", true, "skipped")
    };
  }

  try {
    if (!state.plan) {
      throw new Error("Plan missing; cannot apply");
    }

    const result = await applyPlan(state.plan, { apply: true });
    return {
      applySummary: toApplySummary(state.plan, result.patchFiles),
      audit: appendAudit(state, "apply_plan", true, `patches=${String(result.patchFiles.length)}`)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "apply_plan failed";
    return {
      audit: appendAudit(state, "apply_plan", false, message),
      errors: appendError(state, message)
    };
  }
};

export const node_verify = async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
  if (!state.flags.verify) {
    return {
      audit: appendAudit(state, "verify", true, "skipped")
    };
  }

  try {
    if (!state.plan) {
      throw new Error("Plan missing; cannot verify");
    }

    const result = await runCmd("pnpm", ["build"], state.plan.appDir);
    const verifyResult: VerifyResult = {
      ok: result.ok,
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code
    };

    return {
      verifyResult,
      audit: appendAudit(state, "verify", result.ok, `code=${String(result.code)}`)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "verify failed";
    return {
      verifyResult: { ok: false, stdout: "", stderr: message, code: 1 },
      audit: appendAudit(state, "verify", false, message),
      errors: appendError(state, message)
    };
  }
};

export const node_repair = async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
  if (!state.flags.repair) {
    return {
      audit: appendAudit(state, "repair", true, "skipped")
    };
  }

  if (!state.verifyResult || state.verifyResult.ok) {
    return {
      audit: appendAudit(state, "repair", true, "not needed")
    };
  }

  try {
    if (!state.plan) {
      throw new Error("Plan missing; cannot repair");
    }

    const provider = getProviderFromEnv();
    const repaired = await repairOnce({
      projectRoot: state.plan.appDir,
      cmd: "pnpm",
      args: ["build"],
      provider,
      budget: { maxPatches: 5 },
      apply: state.flags.apply
    });

    return {
      repairResult: {
        ok: repaired.ok,
        patchPaths: repaired.patchPaths,
        summary: repaired.summary
      },
      audit: appendAudit(state, "repair", repaired.ok, repaired.summary)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "repair failed";
    return {
      repairResult: {
        ok: false,
        summary: message
      },
      audit: appendAudit(state, "repair", false, message),
      errors: appendError(state, message)
    };
  }
};
