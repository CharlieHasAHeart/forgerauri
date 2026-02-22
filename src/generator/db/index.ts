import type { SpecIR } from "../../spec/schema.js";
import type { Plan } from "../types.js";
import { buildDbPlan } from "./planDb.js";

export const generateDb = async (ir: SpecIR, outDir: string): Promise<Plan> => {
  return buildDbPlan(ir, outDir);
};
