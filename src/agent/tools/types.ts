import type { z } from "zod";
import type { Plan } from "../../generator/types.js";
import type { LlmProvider } from "../../llm/provider.js";
import type { CmdResult } from "../../runner/runCmd.js";
import type { SpecIR } from "../../spec/schema.js";

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; detail?: string };
  meta?: { touchedPaths?: string[] };
};

export type ToolRunContext = {
  provider: LlmProvider;
  runCmdImpl: (cmd: string, args: string[], cwd: string) => Promise<CmdResult>;
  flags: {
    apply: boolean;
    verify: boolean;
    repair: boolean;
    maxPatchesPerTurn: number;
    verifyLevel: "basic" | "full";
  };
  memory: {
    specPath?: string;
    outDir?: string;
    ir?: SpecIR;
    plan?: Plan;
    appDir?: string;
    applySummary?: unknown;
    verifyResult?: CmdResult;
    patchPaths: string[];
    touchedPaths: string[];
  };
};

export type ToolExample = {
  title: string;
  toolCall: { name: string; input: unknown };
  expected: string;
};

export type ToolManifest<TInput = unknown, TOutput = unknown> = {
  name: string;
  version: string;
  category: "high" | "low";
  description: string;
  capabilities: string[];
  inputSchema: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  safety: {
    sideEffects: "none" | "fs" | "exec" | "llm";
    allowlist?: string[];
  };
};

export type ToolRuntime<TInput = unknown> = {
  run: (input: TInput, ctx: ToolRunContext) => Promise<ToolResult>;
  examples?: ToolExample[];
};

export type ToolPackage<TInput = unknown, TOutput = unknown> = {
  manifest: ToolManifest<TInput, TOutput>;
  runtime: ToolRuntime<TInput>;
};

export type ToolSpec<TInput = unknown> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  inputJsonSchema: unknown;
  outputSchema?: z.ZodTypeAny;
  outputJsonSchema?: unknown;
  category: "high" | "low";
  capabilities: string[];
  safety: ToolManifest["safety"];
  docs: string;
  run: (input: TInput, ctx: ToolRunContext) => Promise<ToolResult>;
  examples?: ToolExample[];
};

export type ToolDocPack = {
  name: string;
  category: "high" | "low";
  summary: string;
  inputJsonSchema: unknown;
  outputJsonSchema?: unknown;
  docs: string;
  examples: ToolExample[];
  safety: ToolManifest["safety"];
};
