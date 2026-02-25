import { relative, resolve, sep } from "node:path";

const allowed = new Set(["pnpm", "cargo", "tauri", "node"]);

export const assertCommandAllowed = (cmd: string): void => {
  if (!allowed.has(cmd)) {
    throw new Error(`Command not allowed by policy: ${cmd}`);
  }
};

export const assertPathInside = (root: string, target: string): void => {
  const rel = relative(resolve(root), resolve(target));
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.split(sep).includes("..")) {
    throw new Error(`Path escapes project root: ${target}`);
  }
};

export const assertCwdInside = (projectRoot: string, cwd: string): void => {
  assertPathInside(projectRoot, cwd);
};

export const assertPatchBudget = (count: number, maxPatches: number): void => {
  if (count > maxPatches) {
    throw new Error(`Patch budget exceeded: ${count} > ${maxPatches}`);
  }
};
