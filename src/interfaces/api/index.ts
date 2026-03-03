import type { AgentEvent } from "../../core/agent/events.js";
import type { HumanReviewFn, PlanChangeReviewFn } from "../../core/agent/contracts.js";
import type { ToolSpec } from "../../agent/tools/types.js";
import type { CmdResult } from "../../runner/runCmd.js";
import { createAgentApp } from "../../app/createAgentApp.js";
import type { AgentPolicy } from "../../app/defaultPolicy.js";
import type { LlmPort } from "../../ports/LlmPort.js";
import type { AgentState, AgentStatus, VerifyProjectResult, VerifyStepResult, ErrorKind } from "../../agent/types.js";

export const runAgent = async (args: {
  goal: string;
  specPath: string;
  outDir: string;
  apply: boolean;
  verify: boolean;
  repair: boolean;
  policy?: AgentPolicy;
  maxTurns?: number;
  maxToolCallsPerTurn?: number;
  maxPatches?: number;
  truncation?: "auto" | "disabled";
  compactionThreshold?: number;
  provider?: LlmPort;
  runCmdImpl?: (cmd: string, argv: string[], cwd: string) => Promise<CmdResult>;
  registry?: Record<string, ToolSpec<any>>;
  humanReview?: HumanReviewFn;
  requestPlanChangeReview?: PlanChangeReviewFn;
  onEvent?: (event: AgentEvent) => void;
}): Promise<{ ok: boolean; summary: string; auditPath?: string; patchPaths?: string[]; state: AgentState }> => {
  const app = createAgentApp({
    llm: args.provider,
    commandRunner: args.runCmdImpl,
    registry: args.registry,
    policy: args.policy
  });

  return app.runAgent({
    goal: args.goal,
    specPath: args.specPath,
    outDir: args.outDir,
    apply: args.apply,
    verify: args.verify,
    repair: args.repair,
    policy: args.policy,
    maxTurns: args.maxTurns,
    maxToolCallsPerTurn: args.maxToolCallsPerTurn,
    maxPatches: args.maxPatches,
    truncation: args.truncation,
    compactionThreshold: args.compactionThreshold,
    humanReview:
      args.humanReview || args.requestPlanChangeReview
        ? {
            humanReview: args.humanReview,
            requestPlanChangeReview: args.requestPlanChangeReview
          }
        : undefined,
    onEvent: args.onEvent
  });
};

export type { AgentState, AgentStatus, VerifyProjectResult, VerifyStepResult, ErrorKind };
export type { AgentPolicy };
