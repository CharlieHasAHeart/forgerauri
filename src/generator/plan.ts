import { isAbsolute, join, resolve } from "node:path";
import type { SpecIR } from "../spec/schema.js";
import { buildActionsForFiles } from "./planUtils.js";
import { templateFiles, toAppSlug } from "./templates.js";
import type { Plan } from "./types.js";

export const buildPlan = (ir: SpecIR, outDir: string): Plan => {
  const resolvedOutDir = isAbsolute(outDir) ? outDir : resolve(process.cwd(), outDir);
  const appSlug = toAppSlug(ir.app.name);
  const appDir = join(resolvedOutDir, appSlug);
  const files = templateFiles(ir);

  return {
    outDir: resolvedOutDir,
    appDir,
    actions: buildActionsForFiles(appDir, files)
  };
};
