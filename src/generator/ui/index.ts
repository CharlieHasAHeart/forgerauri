import type { SpecIR } from "../../spec/schema.js";
import type { Plan } from "../types.js";
import { buildUIAPlan } from "./planUIA.js";

export const generateUIA = async (ir: SpecIR, outDir: string): Promise<Plan> => {
  return buildUIAPlan(ir, outDir);
};
