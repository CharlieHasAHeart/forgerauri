import type { SpecIR } from "../../spec/schema.js";
import type { Plan } from "../types.js";
import { buildBusinessPlan } from "./planBusiness.js";

export const generateBusiness = async (ir: SpecIR, outDir: string): Promise<Plan> => {
  return buildBusinessPlan(ir, outDir);
};
