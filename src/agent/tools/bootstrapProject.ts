import { readFile } from "node:fs/promises";
import { z } from "zod";
import { applyPlan } from "../../generator/apply.js";
import { generateScaffold } from "../../generator/scaffold/index.js";
import type { Plan, PlanActionType } from "../../generator/types.js";
import type { LlmProvider } from "../../llm/provider.js";
import { enrichWireSpecWithLLM } from "../../spec/enrichWithLLM.js";
import { loadSpec, parseSpecFromRaw } from "../../spec/loadSpec.js";
import type { BootstrapProjectResult } from "../types.js";

export const bootstrapProjectInputSchema = z.object({
  specPath: z.string().min(1),
  outDir: z.string().min(1),
  apply: z.boolean().default(true),
  llmEnrich: z.boolean().default(false)
});

const summarizePlan = (plan: Plan): Record<PlanActionType, number> => {
  const counts: Record<PlanActionType, number> = { CREATE: 0, OVERWRITE: 0, SKIP: 0, PATCH: 0 };
  plan.actions.forEach((action) => {
    counts[action.type] += 1;
  });
  return counts;
};

export const runBootstrapProject = async (args: {
  specPath: string;
  outDir: string;
  apply: boolean;
  llmEnrich: boolean;
  provider: LlmProvider;
}): Promise<BootstrapProjectResult> => {
  let ir = await loadSpec(args.specPath);
  let usedLLM = false;

  if (args.llmEnrich) {
    try {
      const rawText = await readFile(args.specPath, "utf8");
      const rawJson = JSON.parse(rawText) as unknown;
      const enriched = await enrichWireSpecWithLLM({ wire: rawJson, provider: args.provider });
      ir = parseSpecFromRaw(enriched.wireEnriched);
      usedLLM = enriched.used;
    } catch {
      usedLLM = false;
    }
  }

  const plan = await generateScaffold(ir, args.outDir);
  const planCounts = summarizePlan(plan);

  const applyResult = await applyPlan(plan, { apply: args.apply });

  return {
    ok: true,
    appDir: plan.appDir,
    usedLLM,
    planSummary: {
      create: planCounts.CREATE,
      overwrite: planCounts.OVERWRITE,
      skip: planCounts.SKIP,
      patch: planCounts.PATCH
    },
    applySummary: {
      create: planCounts.CREATE,
      overwrite: planCounts.OVERWRITE,
      skip: planCounts.SKIP,
      patch: planCounts.PATCH,
      patchPaths: applyResult.patchFiles,
      applied: args.apply
    }
  };
};
