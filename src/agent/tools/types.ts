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

export type ToolSpec<TInput = unknown> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  inputJsonSchema: unknown;
  run: (input: TInput, ctx: ToolRunContext) => Promise<ToolResult>;
};
