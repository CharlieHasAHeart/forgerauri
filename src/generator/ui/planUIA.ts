import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { SpecIR } from "../../spec/schema.js";
import { toAppSlug } from "../templates.js";
import type { Plan, PlanAction } from "../types.js";
import { templateUIAFiles } from "./templatesUIA.js";

const sortUnique = (values: string[]): string[] => Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));

const createDirAction = (path: string, exists: boolean): PlanAction => ({
  type: exists ? "SKIP" : "CREATE",
  path,
  entryType: "dir",
  reason: exists ? "directory exists" : "new directory",
  safe: true,
  mode: "generated"
});

const createFileAction = (path: string, content: string): PlanAction => {
  if (!existsSync(path)) {
    return {
      type: "CREATE",
      path,
      entryType: "file",
      reason: "new file",
      content,
      safe: true,
      mode: "generated"
    };
  }

  const current = readFileSync(path, "utf8");
  if (current === content) {
    return {
      type: "SKIP",
      path,
      entryType: "file",
      reason: "unchanged",
      safe: true,
      mode: "generated"
    };
  }

  return {
    type: "OVERWRITE",
    path,
    entryType: "file",
    reason: "content changed",
    content,
    safe: true,
    mode: "generated"
  };
};

export const buildUIAPlan = (ir: SpecIR, outDir: string): Plan => {
  const resolvedOutDir = isAbsolute(outDir) ? outDir : resolve(process.cwd(), outDir);
  const appSlug = toAppSlug(ir.app.name);
  const appDir = join(resolvedOutDir, appSlug);
  const files = templateUIAFiles(ir);

  const dirCandidates = [appDir];
  Object.keys(files).forEach((relativePath) => {
    dirCandidates.push(join(appDir, dirname(relativePath)));
  });

  const actions: PlanAction[] = [];
  sortUnique(dirCandidates).forEach((dirPath) => {
    actions.push(createDirAction(dirPath, existsSync(dirPath)));
  });

  Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([relativePath, content]) => {
      const absolutePath = join(appDir, relativePath);
      actions.push(createFileAction(absolutePath, content));
    });

  return {
    outDir: resolvedOutDir,
    appDir,
    actions
  };
};
