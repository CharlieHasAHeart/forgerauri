import { createApplyStructuredEditsTool } from "../tools/patch/applyStructuredEdits.js";
import { createVerifyRunTool } from "../tools/verify/runVerifiedCommand.js";
import { createFilesystemMiddleware } from "../middleware/filesystem.js";
import { createHumanInTheLoopMiddleware } from "../middleware/humanInTheLoop.js";
import { defaultAgentPolicy } from "../core/agent/policy/policy.js";
import type { HumanReviewPort } from "../core/agent/contracts.js";
import type { CoreRunDeps } from "../core/agent/flow/runAgent.js";
import type { LlmMessage, LlmPort } from "../core/contracts/llm.js";
import type { CommandRunnerPort } from "../core/contracts/runtime.js";
import type { ToolSpec } from "../core/contracts/tools.js";
import type { KernelMiddleware } from "../core/middleware/types.js";
import type { AgentPolicy } from "../core/contracts/policy.js";

const DESKTOP_PATCH_WORKFLOW_RULE =
  "For code modifications, prefer structured patch workflows and verification-first execution. Do not use direct file mutation tools unless explicitly enabled by the profile.";

const createWorkflowRulesMiddleware = (): KernelMiddleware => ({
  name: "desktop_patch_workflow_rules",
  wrapProvider: (provider: LlmPort): LlmPort => {
    const prependRule = (messages: LlmMessage[]): LlmMessage[] => [
      { role: "system", content: DESKTOP_PATCH_WORKFLOW_RULE },
      ...messages
    ];
    return {
      ...provider,
      complete:
        provider.complete &&
        (async (messages, opts) => {
          return await provider.complete!(prependRule(messages), opts);
        }),
      completeJSON:
        provider.completeJSON &&
        (async (messages, schema, opts) => {
          return await provider.completeJSON!(prependRule(messages), schema, opts);
        })
    };
  }
});

export type DesktopPatchWorkflowProfileArgs = {
  llm: LlmPort;
  commandRunner: CommandRunnerPort;
  baseRegistry?: Record<string, ToolSpec<any>>;
  baseMiddlewares?: KernelMiddleware[];
  humanReview?: HumanReviewPort;
  policy?: AgentPolicy;
};

export const createDesktopPatchWorkflowDeps = (args: DesktopPatchWorkflowProfileArgs): CoreRunDeps => {
  const registry: Record<string, ToolSpec<any>> = {
    ...(args.baseRegistry ?? {}),
    verify_run: createVerifyRunTool(),
    apply_structured_edits: createApplyStructuredEditsTool()
  };
  const allowedTools = Object.keys(registry).filter(
    (name) => name !== "write_file" && name !== "edit_file" && name !== "delete_file"
  );
  const policy =
    args.policy ??
    defaultAgentPolicy({
      maxSteps: 12,
      maxActionsPerTask: 8,
      maxRetriesPerTask: 3,
      maxReplans: 3,
      allowedTools
    });

  return {
    policy,
    registry,
    llm: args.llm,
    commandRunner: args.commandRunner,
    humanReview: args.humanReview,
    middlewares: [
      ...(args.baseMiddlewares ?? []),
      createFilesystemMiddleware({ readOnly: true }),
      createHumanInTheLoopMiddleware({
        humanReview: args.humanReview?.humanReview,
        options: {
          patchTools: ["apply_structured_edits"]
        }
      }),
      createWorkflowRulesMiddleware()
    ]
  };
};
