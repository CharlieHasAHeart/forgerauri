import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { classifyPath } from "./zones.js";
import type { Plan } from "./types.js";

const BASE64_PREFIX = "__BASE64__:";

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

const toSafePatchName = (relativePath: string): string =>
  relativePath
    .replace(/[\\/]+/g, "__")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");

export const applyPlan = async (plan: Plan, opts: { apply: boolean }): Promise<{ patchFiles: string[] }> => {
  const root = resolve(plan.appDir);
  const patchFiles: string[] = [];

  plan.actions.forEach((action) => {
    ensureInside(root, action.path);
  });

  if (!opts.apply) {
    return { patchFiles };
  }

  for (const action of plan.actions) {
    ensureInside(root, action.path);
    const rel = relative(root, resolve(action.path)).split(sep).join("/");
    const zone = classifyPath(rel);

    if (action.type !== "CREATE" && action.type !== "OVERWRITE") {
      if (action.type === "PATCH" && action.entryType === "file") {
        const patchDir = resolve(root, "generated/patches");
        await mkdir(patchDir, { recursive: true });
        const patchPath = resolve(patchDir, `${toSafePatchName(rel)}.patch`);
        ensureInside(root, patchPath);
        await writeFile(patchPath, action.patchText ?? "", "utf8");
        action.patchFilePath = patchPath;
        patchFiles.push(patchPath);
      }
      continue;
    }

    if (zone === "user" && action.type === "OVERWRITE") {
      continue;
    }

    if (action.entryType === "dir") {
      await mkdir(action.path, { recursive: true });
      continue;
    }

    if (action.entryType === "file") {
      if (zone === "user" && action.type === "OVERWRITE") {
        continue;
      }
      if (typeof action.content !== "string") {
        throw new Error(`Missing file content for ${action.path}`);
      }
      await mkdir(dirname(action.path), { recursive: true });
      if (action.content.startsWith(BASE64_PREFIX)) {
        const base64 = action.content.slice(BASE64_PREFIX.length).replace(/\s+/g, "");
        await writeFile(action.path, Buffer.from(base64, "base64"));
      } else {
        await writeFile(action.path, action.content, "utf8");
      }
    }
  }

  return { patchFiles };
};
