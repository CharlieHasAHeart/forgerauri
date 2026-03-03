import { isAbsolute, resolve } from "node:path";
import { normalizePath } from "./path_normalizer.js";

const normalizeSlash = (value: string): string => normalizePath(value.replace(/\\/g, "/")).canonical;

export const canonicalizeCwd = (cwd: string, repoRoot: string): string => {
  const repo = normalizeSlash(resolve(repoRoot));
  const absolute = isAbsolute(cwd) ? resolve(cwd) : resolve(repo, cwd);
  return normalizeSlash(absolute);
};
