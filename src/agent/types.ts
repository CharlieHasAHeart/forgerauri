import type { CmdResult } from "../runner/runCmd.js";
import type { ContractDesignV1 } from "./design/contract/schema.js";
import type { DeliveryDesignV1 } from "./design/delivery/schema.js";
import type { ImplementationDesignV1 } from "./design/implementation/schema.js";
import type { UXDesignV1 } from "./design/ux/schema.js";
import type { PlanChangeDecision, PlanChangeRequestV2, PlanV1 } from "./plan/schema.js";

/**
 * @deprecated Legacy terminal alias only. Use AgentStatus for plan-first runtime state.
 */
export type AgentPhase = "DONE" | "FAILED";
export type AgentStatus = "planning" | "executing" | "reviewing" | "replanning" | "done" | "failed";

export type ErrorKind = "Deps" | "TS" | "Rust" | "Tauri" | "Config" | "Unknown";

export type VerifyStepResult = {
  name: "install" | "install_retry" | "build" | "build_retry" | "cargo_check" | "tauri_check" | "tauri_build";
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  skipped?: boolean;
};

export type VerifyProjectResult = {
  ok: boolean;
  step: VerifyStepResult["name"] | "none";
  results: VerifyStepResult[];
  summary: string;
  classifiedError: ErrorKind;
  suggestion: string;
};

export type AgentBudgets = {
  maxTurns: number;
  maxPatches: number;
  usedTurns: number;
  usedPatches: number;
  usedRepairs: number;
};

export type AgentState = {
  /** @deprecated Legacy terminal alias. Prefer `status`. */
  phase?: AgentPhase;
  status: AgentStatus;
  goal: string;
  specPath: string;
  outDir: string;
  flags: {
    apply: boolean;
    verify: boolean;
    repair: boolean;
    truncation: "auto" | "disabled";
    compactionThreshold?: number;
  };
  lastResponseId?: string;
  projectRoot?: string;
  appDir?: string;
  contract?: ContractDesignV1;
  contractPath?: string;
  ux?: UXDesignV1;
  uxPath?: string;
  impl?: ImplementationDesignV1;
  implPath?: string;
  delivery?: DeliveryDesignV1;
  deliveryPath?: string;
  designValidation?: {
    ok: boolean;
    errorsCount: number;
    summary: string;
  };
  lastDeterministicFixes?: string[];
  repairKnownChecked?: boolean;
  codegenSummary?: {
    generatedFilesCount: number;
    wrote: number;
    skipped: number;
  };
  usedLLM: boolean;
  verifyHistory: VerifyProjectResult[];
  lastError?: {
    kind: ErrorKind;
    message: string;
    command?: { cmd: string; args: string[]; cwd: string };
  };
  budgets: AgentBudgets;
  patchPaths: string[];
  humanReviews: Array<{ reason: string; approved: boolean; patchPaths: string[] }>;
  touchedFiles: string[];
  toolCalls: Array<{ name: string; input: unknown }>;
  toolResults: Array<{ name: string; ok: boolean; note?: string }>;
  planVersion?: number;
  currentTaskId?: string;
  completedTasks?: string[];
  planData?: PlanV1;
  planHistory?: Array<
    | { type: "initial"; version: number; plan: PlanV1 }
    | { type: "change_request"; request: PlanChangeRequestV2 }
    | { type: "change_decision"; decision: PlanChangeDecision }
  >;
};

export type BootstrapProjectResult = {
  ok: boolean;
  appDir: string;
  usedLLM: boolean;
  planSummary: { create: number; overwrite: number; skip: number; patch: number };
  applySummary: { create: number; overwrite: number; skip: number; patch: number; patchPaths: string[]; applied: boolean };
};

export type AgentCmdRunner = (cmd: string, args: string[], cwd: string) => Promise<CmdResult>;
