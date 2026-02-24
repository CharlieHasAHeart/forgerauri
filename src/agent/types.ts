import type { CmdResult } from "../runner/runCmd.js";

export type AgentPhase = "BOOT" | "VERIFY" | "REPAIR" | "DONE" | "FAILED";

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
    llmEnrich: boolean;
    verifyLevel: "basic" | "full";
  };
  projectRoot?: string;
  appDir?: string;
  usedLLM: boolean;
  verifyHistory: VerifyProjectResult[];
  lastError?: {
    kind: ErrorKind;
    message: string;
    command?: { cmd: string; args: string[]; cwd: string };
  };
  budgets: AgentBudgets;
  patchPaths: string[];
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
