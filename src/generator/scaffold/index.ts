import type { SpecIR } from "../../spec/schema.js";
import { buildCommandsPlan } from "../commands/planCommands.js";
import { buildDbPlan } from "../db/planDb.js";
import { buildPlan } from "../plan.js";
import type { Plan } from "../types.js";
import { buildUIAPlan } from "../ui/planUIA.js";

const mergePlans = (...plans: Plan[]): Plan => {
  const [first] = plans;
  if (!first) {
    throw new Error("No plans to merge");
  }

  const byPath = new Map<string, Plan["actions"][number]>();

  plans.forEach((plan) => {
    plan.actions.forEach((action) => {
      byPath.set(`${action.entryType}:${action.path}`, action);
    });
  });

  const actions = Array.from(byPath.values()).sort((left, right) => left.path.localeCompare(right.path));
  return {
    outDir: first.outDir,
    appDir: first.appDir,
    actions
  };
};

export const generateScaffold = async (ir: SpecIR, outDir: string): Promise<Plan> => {
  const scaffoldPlan = buildPlan(ir, outDir);
  const dbPlan = buildDbPlan(ir, outDir);
  const commandsPlan = buildCommandsPlan(ir, outDir);
  const uiAPlan = buildUIAPlan(ir, outDir);
  return mergePlans(scaffoldPlan, dbPlan, commandsPlan, uiAPlan);
};
