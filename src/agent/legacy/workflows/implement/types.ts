export type PatchFile = { filePath: string; newContent: string; reason: string };

export type ImplementTarget = { kind: "ui" } | { kind: "commands"; name: string } | { kind: "business" };

export type ImplementRequest = {
  projectRoot: string;
  specPath: string;
  target: ImplementTarget;
  maxPatches: number;
};

export type ImplementResult = {
  ok: boolean;
  applied: boolean;
  patchPaths: string[];
  changedPaths: string[];
  summary: string;
  verify?: { ok: boolean; code: number; stdout: string; stderr: string };
};
