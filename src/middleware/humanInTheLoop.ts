import type { HumanReviewFn } from "../core/agent/contracts.js";
import type { KernelMiddleware } from "../core/middleware/types.js";
import type { ToolRunContext } from "../core/contracts/tools.js";

export type HumanInTheLoopOptions = {
  patchTools: string[];
  reviewReason?: {
    patchApply?: string;
    commandExec?: string;
  };
  commandAllowlist?: string[];
};

const summarizeInput = (value: unknown, limit = 800): string => {
  try {
    const text = JSON.stringify(value);
    if (!text) return "";
    return text.length <= limit ? text : `${text.slice(0, limit)}...<truncated>`;
  } catch {
    return "<unserializable input>";
  }
};

const extractPatchMetadata = (ctx: ToolRunContext): {
  patchRef?: string;
  patchPath?: string;
  changedFiles?: string[];
} => {
  const patchPaths = Array.isArray(ctx.memory.patchPaths) ? ctx.memory.patchPaths : [];
  const patchPath = patchPaths.length > 0 ? patchPaths[patchPaths.length - 1] : undefined;
  return { patchPath };
};

export const createHumanInTheLoopMiddleware = (args: {
  humanReview?: HumanReviewFn;
  options: HumanInTheLoopOptions;
}): KernelMiddleware => ({
  name: "human_in_the_loop",
  async init({ ctx, state }) {
    const original = ctx.runCmdImpl;
    ctx.runCmdImpl = async (cmd, cmdArgs, cwd) => {
      if (args.options.commandAllowlist && !args.options.commandAllowlist.includes(cmd)) {
        return await original(cmd, cmdArgs, cwd);
      }
      if (!args.humanReview) {
        state.humanReviews.push({
          action: "command_exec",
          approved: false,
          command: cmd,
          args: cmdArgs,
          cwd,
          phase: state.status,
          reason: args.options.reviewReason?.commandExec ?? "Command execution requires human approval",
          ts: Date.now()
        });
        return { ok: false, code: 126, stdout: "", stderr: "Human review required but not available" };
      }
      const approved = await args.humanReview({
        action: "command_exec",
        phase: state.status,
        reason: args.options.reviewReason?.commandExec ?? "Command execution requires human approval",
        command: cmd,
        args: cmdArgs,
        cwd
      });
      state.humanReviews.push({
        action: "command_exec",
        approved,
        command: cmd,
        args: cmdArgs,
        cwd,
        phase: state.status,
        reason: args.options.reviewReason?.commandExec ?? "Command execution requires human approval",
        ts: Date.now()
      });
      if (!approved) {
        return { ok: false, code: 126, stdout: "", stderr: "Human review denied" };
      }
      return await original(cmd, cmdArgs, cwd);
    };
  },
  hooks: {
    onBeforeToolCall: async ({ call, ctx, state }) => {
      if (!args.options.patchTools.includes(call.name)) {
        return { action: "allow" };
      }
      if (!args.humanReview) {
        state.humanReviews.push({
          action: "patch_apply",
          approved: false,
          phase: state.status,
          toolName: call.name,
          inputSummary: summarizeInput(call.input),
          reason: args.options.reviewReason?.patchApply ?? "File changes require human approval",
          ts: Date.now()
        });
        return {
          action: "deny",
          error: {
            code: "HUMAN_REVIEW_REQUIRED",
            message: "Human review required but not available for patch apply"
          }
        };
      }
      const metadata = extractPatchMetadata(ctx);
      const reason = args.options.reviewReason?.patchApply ?? "File changes require human approval";
      const approved = await args.humanReview({
        action: "patch_apply",
        phase: state.status,
        reason,
        toolName: call.name,
        inputSummary: summarizeInput(call.input),
        patchRef: metadata.patchRef,
        patchPath: metadata.patchPath,
        changedFiles: metadata.changedFiles
      });
      state.humanReviews.push({
        action: "patch_apply",
        approved,
        phase: state.status,
        reason,
        toolName: call.name,
        inputSummary: summarizeInput(call.input),
        patchRef: metadata.patchRef,
        patchPath: metadata.patchPath,
        changedFiles: metadata.changedFiles,
        ts: Date.now()
      });
      if (!approved) {
        return {
          action: "deny",
          error: {
            code: "HUMAN_REVIEW_DENIED",
            message: "Human review denied patch apply"
          }
        };
      }
      return { action: "allow" };
    }
  }
});
