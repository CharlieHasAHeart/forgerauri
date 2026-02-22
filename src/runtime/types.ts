import type { Zone } from "../generator/zones.js";

export type { Zone };

export type RunBudget = {
  maxTurns: number;
  maxPatches: number;
};

export type AuditEvent = {
  kind: "llm_call" | "tool_call" | "plan" | "apply" | "run";
  data: unknown;
  ts: number;
};

export type RuntimeResult = {
  ok: boolean;
  audit: AuditEvent[];
  summary: string;
  patchPaths?: string[];
};
