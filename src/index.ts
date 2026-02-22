export { loadSpec } from "./spec/loadSpec.js";
export type { SpecIR } from "./spec/schema.js";
export { generateScaffold } from "./generator/scaffold/index.js";
export { buildPlan } from "./generator/plan.js";
export { generateDb } from "./generator/db/index.js";
export { buildDbPlan } from "./generator/db/planDb.js";
export { applyPlan } from "./generator/apply.js";
export type { FileWriteMode, Plan, PlanAction, PlanActionType } from "./generator/types.js";
