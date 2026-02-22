import type { SpecIR } from "../../spec/schema.js";
import type { Plan } from "../types.js";
import { buildCommandsPlan } from "./planCommands.js";

export const generateCommands = async (ir: SpecIR, outDir: string): Promise<Plan> => {
  return buildCommandsPlan(ir, outDir);
};
