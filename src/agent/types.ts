import type { CmdResult } from "../runner/runCmd.js";
import type { ContractDesignV1 } from "./design/contract/schema.js";
import type { DeliveryDesignV1 } from "./design/delivery/schema.js";
import type { ImplementationDesignV1 } from "./design/implementation/schema.js";
import type { UXDesignV1 } from "./design/ux/schema.js";

export type AgentPhase =
  | "BOOT"
  | "DESIGN_CONTRACT"
  | "MATERIALIZE_CONTRACT"
  | "DESIGN_UX"
  | "MATERIALIZE_UX"
  | "DESIGN_IMPL"
  | "MATERIALIZE_IMPL"
  | "DESIGN_DELIVERY"
  | "MATERIALIZE_DELIVERY"
  | "VALIDATE_DESIGN"
  | "CODEGEN_FROM_DESIGN"
  | "VERIFY"
  | "REPAIR"
  | "DONE"
  | "FAILED";

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
  phase: AgentPhase;
  goal: string;
  specPath: string;
  outDir: string;
  flags: {
    apply: boolean;
    verify: boolean;
    repair: boolean;
  };
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
};

export type BootstrapProjectResult = {
  ok: boolean;
  appDir: string;
  usedLLM: boolean;
  planSummary: { create: number; overwrite: number; skip: number; patch: number };
  applySummary: { create: number; overwrite: number; skip: number; patch: number; patchPaths: string[]; applied: boolean };
};

export type AgentCmdRunner = (cmd: string, args: string[], cwd: string) => Promise<CmdResult>;
