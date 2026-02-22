import type { SpecIR } from "../../spec/schema.js";
import type { Plan } from "../types.js";
import { buildUIAPlan } from "./planUIA.js";
import { buildUIBPlan } from "./planUIB.js";

export const generateUIA = async (ir: SpecIR, outDir: string): Promise<Plan> => {
  return buildUIAPlan(ir, outDir);
};

export const generateUIB = async (ir: SpecIR, outDir: string): Promise<Plan> => {
  return buildUIBPlan(ir, outDir);
};
