import { platform } from "node:os";
import type { Evidence, ParsedError } from "../../core/contracts/context.js";
import type { AgentState } from "../../core/contracts/state.js";
import type { ToolRunContext, ToolResult, ToolSpec } from "../../core/contracts/tools.js";
import { storeBlob } from "../../core/utils/blobStore.js";

type VerifyInput = {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
};

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected object input");
  return value as Record<string, unknown>;
};

const parseInput = (value: unknown): VerifyInput => {
  const obj = asObject(value);
  const command = typeof obj.command === "string" ? obj.command.trim() : "";
  if (!command) throw new Error("command must be non-empty string");
  const args = Array.isArray(obj.args) ? obj.args.map(String) : [];
  const cwd = typeof obj.cwd === "string" && obj.cwd.trim() ? obj.cwd.trim() : undefined;
  const timeoutMs =
    typeof obj.timeoutMs === "number" && Number.isFinite(obj.timeoutMs) && obj.timeoutMs > 0 ? Math.floor(obj.timeoutMs) : undefined;
  return { command, args, cwd, timeoutMs };
};

const parseTsErrors = (text: string): ParsedError[] => {
  const out: ParsedError[] = [];
  const re = /^(.+?):(\d+):(\d+)\s*-\s*error\s*(TS\d+):\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({
      file: m[1].trim(),
      line: Number(m[2]),
      col: Number(m[3]),
      code: m[4],
      message: m[5].trim()
    });
  }
  return out;
};

const parseRustErrors = (text: string): ParsedError[] => {
  const out: ParsedError[] = [];
  const lines = text.split(/\r?\n/);
  let pendingCode: string | undefined;
  let pendingMessage: string | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const codeMatch = line.match(/^error\[(E\d+)\]:\s*(.+)$/);
    if (codeMatch) {
      pendingCode = codeMatch[1];
      pendingMessage = codeMatch[2].trim();
      continue;
    }
    const locMatch = line.match(/^\s*-->\s+(.+?):(\d+):(\d+)\s*$/);
    if (locMatch && pendingCode) {
      out.push({
        file: locMatch[1].trim(),
        line: Number(locMatch[2]),
        col: Number(locMatch[3]),
        code: pendingCode,
        message: pendingMessage ?? "rust error"
      });
      pendingCode = undefined;
      pendingMessage = undefined;
    }
  }
  return out;
};

const toEvidence = (args: {
  command: string;
  subArgs: string[];
  result: { ok: boolean; code: number; stdout: string; stderr: string };
  ctx: ToolRunContext;
}): Evidence => {
  const parsedErrors = [...parseTsErrors(args.result.stdout), ...parseTsErrors(args.result.stderr), ...parseRustErrors(args.result.stderr)];
  const stdoutRef = storeBlob(args.ctx, args.result.stdout ?? "", "stdout");
  const stderrRef = storeBlob(args.ctx, args.result.stderr ?? "", "stderr");
  return {
    command: [args.command, ...args.subArgs].join(" ").trim(),
    exitCode: args.result.code,
    ok: args.result.ok && args.result.code === 0,
    parsedErrors,
    stdoutRef,
    stderrRef,
    timestamp: new Date().toISOString(),
    platform: platform()
  };
};

const getStateFromMemory = (ctx: ToolRunContext): AgentState | undefined => {
  const candidate = ctx.memory.agentState;
  if (!candidate || typeof candidate !== "object") return undefined;
  return candidate as AgentState;
};

export const createVerifyRunTool = (): ToolSpec<VerifyInput> => ({
  name: "verify_run",
  description: "Run a verification command and return structured Evidence.",
  inputSchema: {
    parse: parseInput
  },
  async run(input, ctx): Promise<ToolResult> {
    try {
      const state = getStateFromMemory(ctx);
      const cwd = input.cwd ?? ctx.memory.appDir ?? state?.appDir ?? ctx.memory.runDir ?? state?.runDir ?? process.cwd();
      const result = await ctx.runCmdImpl(input.command, input.args ?? [], cwd);
      const evidence = toEvidence({
        command: input.command,
        subArgs: input.args ?? [],
        result,
        ctx
      });
      if (state) state.lastEvidence = evidence;
      ctx.memory.verifyEvidence = evidence;
      return {
        ok: evidence.ok,
        data: evidence,
        error: evidence.ok ? undefined : { code: "VERIFY_FAILED", message: `verify_run failed with exit code ${evidence.exitCode}` },
        meta: { touchedPaths: [] }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "VERIFY_RUN_ERROR",
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
});
