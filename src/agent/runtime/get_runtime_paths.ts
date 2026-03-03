import { isAbsolute, join, resolve } from "node:path";
import type { RuntimePaths } from "../core/runtime_paths/types.js";
import { normalizePath } from "../core/runtime_paths/path_normalizer.js";
import type { ToolRunContext } from "../tools/types.js";
import type { AgentState } from "../types.js";

const normalizeSlash = (value: string): string => normalizePath(value.replace(/\\/g, "/")).canonical;

const toAbsoluteNormalized = (value: string, base: string): string =>
  normalizeSlash(isAbsolute(value) ? resolve(value) : resolve(base, value));

export const getRuntimePaths = (ctx: ToolRunContext, state: AgentState): RuntimePaths => {
  const statePaths = state.runtimePaths;
  if (statePaths) {
    return {
      repoRoot: normalizeSlash(statePaths.repoRoot),
      appDir: normalizeSlash(statePaths.appDir),
      tauriDir: normalizeSlash(statePaths.tauriDir)
    };
  }

  const memoryPaths = ctx.memory.runtimePaths;
  if (memoryPaths) {
    return {
      repoRoot: normalizeSlash(memoryPaths.repoRoot),
      appDir: normalizeSlash(memoryPaths.appDir),
      tauriDir: normalizeSlash(memoryPaths.tauriDir)
    };
  }

  const repoRootCandidate = ctx.memory.repoRoot ?? state.projectRoot ?? process.cwd();
  const repoRoot = toAbsoluteNormalized(repoRootCandidate, process.cwd());
  const appDirCandidate = ctx.memory.appDir ?? state.appDir ?? ctx.memory.outDir ?? state.outDir ?? join(repoRoot, "generated/app");
  const appDir = toAbsoluteNormalized(appDirCandidate, repoRoot);
  const tauriDirCandidate = ctx.memory.tauriDir ?? join(appDir, "src-tauri");
  const tauriDir = toAbsoluteNormalized(tauriDirCandidate, repoRoot);

  return { repoRoot, appDir, tauriDir };
};
