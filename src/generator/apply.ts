import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { Plan } from "./types.js";

const ensureInside = (root: string, target: string): void => {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);

  if (resolvedTarget === resolvedRoot) {
    return;
  }

  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`Refusing to write outside output directory: ${resolvedTarget}`);
  }
  if (rel.split(sep).includes("..")) {
    throw new Error(`Refusing to write outside output directory: ${resolvedTarget}`);
  }
};

export const applyPlan = async (plan: Plan, opts: { apply: boolean }): Promise<void> => {
  const root = resolve(plan.appDir);

  plan.actions.forEach((action) => {
    ensureInside(root, action.path);
  });

  if (!opts.apply) {
    return;
  }

  for (const action of plan.actions) {
    ensureInside(root, action.path);

    if (action.type !== "CREATE" && action.type !== "OVERWRITE") {
      continue;
    }

    if (action.entryType === "dir") {
      await mkdir(action.path, { recursive: true });
      continue;
    }

    if (action.entryType === "file") {
      if (typeof action.content !== "string") {
        throw new Error(`Missing file content for ${action.path}`);
      }
      await mkdir(dirname(action.path), { recursive: true });
      await writeFile(action.path, action.content, "utf8");
    }
  }
};
