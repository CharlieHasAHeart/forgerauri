import type { SpecIR } from "../../spec/schema.js";
import { buildPlan } from "../plan.js";
import type { Plan } from "../types.js";

export const generateScaffold = async (ir: SpecIR, outDir: string): Promise<Plan> => {
  return buildPlan(ir, outDir);
};
