import type { PlanChangeRequestV2, PlanPatchOperation, PlanV1, ToolCall } from "./planning.js";
import type { RuntimePaths } from "./runtime.js";

export type AgentStatus = "planning" | "executing" | "reviewing" | "replanning" | "done" | "failed";
export type ErrorKind = "Unknown" | "Config";

export type AgentState = {
  goal: string;
  specPath: string;
  outDir: string;
  appDir?: string;
  projectRoot?: string;
  runtimePaths?: RuntimePaths;
  currentTaskId?: string;
  flags: {
    truncation?: "auto" | "disabled";
    compactionThreshold?: number;
  };
  status: AgentStatus;
  usedLLM: boolean;
  verifyHistory: unknown[];
  budgets: {
    maxTurns: number;
    maxPatches: number;
    usedTurns: number;
    usedPatches: number;
    usedRepairs: number;
  };
  patchPaths: string[];
  humanReviews: Array<{ reason: string; approved: boolean; patchPaths: string[]; phase?: AgentStatus }>;
  lastDeterministicFixes: string[];
  repairKnownChecked: boolean;
  touchedFiles: string[];
  toolCalls: ToolCall[];
  toolResults: Array<{ name: string; ok: boolean; note?: string }>;
  planData?: PlanV1;
  planVersion?: number;
  completedTasks?: string[];
  planHistory?: Array<
    | { type: "initial"; version: number; plan: PlanV1 }
    | { type: "change_request"; request: PlanChangeRequestV2 }
    | { type: "change_gate_result"; gateResult: unknown }
    | { type: "change_user_review_text"; text: string }
    | { type: "change_review_outcome"; outcome: unknown }
    | { type: "change_applied"; version: number; patch: PlanPatchOperation[] }
  >;
  contract?: unknown;
  ux?: unknown;
  impl?: unknown;
  delivery?: unknown;
  lastResponseId?: string;
  lastError?: {
    kind: ErrorKind;
    code?: string;
    message: string;
  };
};
