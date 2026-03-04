import type { LlmPort } from "./llm.js";
import type { CommandRunnerPort, RuntimePaths } from "./runtime.js";

export type ToolError = {
  code: string;
  message: string;
  detail?: string;
};

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: ToolError;
  meta?: {
    touchedPaths?: string[];
  };
};

export type ToolRunContext = {
  provider: LlmPort;
  runCmdImpl: CommandRunnerPort;
  flags: {
    maxPatchesPerTurn: number;
  };
  memory: {
    repoRoot?: string;
    specPath?: string;
    outDir?: string;
    appDir?: string;
    tauriDir?: string;
    runtimePaths?: RuntimePaths;
    patchPaths: string[];
    touchedPaths: string[];
    verifyResult?: {
      ok: boolean;
      code: number;
      stdout: string;
      stderr: string;
    };
    [key: string]: unknown;
  };
};

export type ToolSpec<TInput = unknown> = {
  name: string;
  description?: string;
  inputSchema?: {
    parse: (value: unknown) => TInput;
  };
  run: (input: TInput, ctx: ToolRunContext) => Promise<ToolResult> | ToolResult;
};

export type ToolDocPack = {
  name: string;
  description?: string;
  examples?: string[];
};
