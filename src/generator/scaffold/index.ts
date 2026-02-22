import type { SpecIR } from "../../spec/schema.js";
import { buildDbPlan } from "../db/planDb.js";
import { buildPlan } from "../plan.js";
import type { Plan } from "../types.js";

const mergePlans = (scaffoldPlan: Plan, dbPlan: Plan): Plan => {
  const byPath = new Map<string, (typeof scaffoldPlan.actions)[number]>();

  scaffoldPlan.actions.forEach((action) => {
    byPath.set(`${action.entryType}:${action.path}`, action);
  });

  dbPlan.actions.forEach((action) => {
    byPath.set(`${action.entryType}:${action.path}`, action);
  });

  const actions = Array.from(byPath.values()).sort((left, right) => left.path.localeCompare(right.path));
  return {
    outDir: scaffoldPlan.outDir,
    appDir: scaffoldPlan.appDir,
    actions
  };
};

export const generateScaffold = async (ir: SpecIR, outDir: string): Promise<Plan> => {
  const scaffoldPlan = buildPlan(ir, outDir);
  const dbPlan = buildDbPlan(ir, outDir);
  return mergePlans(scaffoldPlan, dbPlan);
};
