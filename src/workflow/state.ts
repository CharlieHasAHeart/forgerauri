import { Annotation } from "@langchain/langgraph";
import type { Plan } from "../generator/types.js";
import type { SpecIR } from "../spec/schema.js";

export type WorkflowFlags = {
  plan: boolean;
  apply: boolean;
  llmEnrich: boolean;
  verify: boolean;
  repair: boolean;
};

export type PlanSummary = {
  create: number;
  overwrite: number;
  skip: number;
  patch: number;
};

export type ApplySummary = PlanSummary & {
  patchPaths: string[];
};

export type VerifyResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
};

export type RepairResult = {
  ok: boolean;
  patchPaths?: string[];
  summary: string;
};

export type AuditItem = {
  node: string;
  ok: boolean;
  note?: string;
};

export const WorkflowStateAnnotation = Annotation.Root({
  specPath: Annotation<string>,
  outDir: Annotation<string>,
  flags: Annotation<WorkflowFlags>,
  wireSpec: Annotation<unknown | null>,
  usedLLM: Annotation<boolean>,
  ir: Annotation<SpecIR | null>,
  plan: Annotation<Plan | null>,
  planSummary: Annotation<PlanSummary | null>,
  applySummary: Annotation<ApplySummary | null>,
  verifyResult: Annotation<VerifyResult | null>,
  repairResult: Annotation<RepairResult | null>,
  audit: Annotation<AuditItem[]>,
  errors: Annotation<string[]>
});

export type WorkflowState = typeof WorkflowStateAnnotation.State;

export const createInitialState = (args: {
  specPath: string;
  outDir: string;
  flags: WorkflowFlags;
}): WorkflowState => ({
  specPath: args.specPath,
  outDir: args.outDir,
  flags: args.flags,
  wireSpec: null,
  usedLLM: false,
  ir: null,
  plan: null,
  planSummary: null,
  applySummary: null,
  verifyResult: null,
  repairResult: null,
  audit: [],
  errors: []
});
