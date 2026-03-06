import type { PlanChangeRequestV2, PlanPatchOperation, PlanV2, ToolCall } from "./planning.js";
import type { RuntimePaths } from "./runtime.js";
import type { Evidence } from "./context.js";

export type AgentStatus = "planning" | "executing" | "reviewing" | "replanning" | "done" | "failed";
export type ErrorKind = "Unknown" | "Config";

export type AgentState = {
  goal: string;
  specRef: string;
  runDir: string;
  appDir?: string;
  activeMilestoneId?: string;
  projectRoot?: string;
  runtimePaths?: RuntimePaths;
  currentTaskId?: string;
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
  humanReviews: Array<{
    action: "command_exec" | "patch_apply";
    approved: boolean;
    phase: AgentStatus;
    reason?: string;
    toolName?: string;
    inputSummary?: string;
    patchRef?: string;
    patchPath?: string;
    changedFiles?: string[];
    command?: string;
    args?: string[];
    cwd?: string;
    ts?: number;
  }>;
  lastDeterministicFixes: string[];
  repairKnownChecked: boolean;
  touchedFiles: string[];
  toolCalls: ToolCall[];
  toolResults: Array<{ name: string; ok: boolean; note?: string }>;
  planData?: PlanV2;
  planVersion?: number;
  completedTasks?: string[];
  milestoneReviewHistory: Array<{ milestoneId: string; ok: boolean; failures?: string[]; ts: number }>;
  goalReviewHistory: Array<{ ok: boolean; failures?: string[]; ts: number }>;
  planHistory?: Array<
    | { type: "initial"; version: number; plan: PlanV2 }
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
  lastEvidence?: Evidence;
  contextHistory: Array<{ turn: number; phase: string; packetRef: string; packetDigest?: string }>;
  memory?: {
    decisions: string[];
    invariants: string[];
    pitfalls: string[];
  };
  lastError?: {
    kind: ErrorKind;
    code?: string;
    message: string;
  };
};
