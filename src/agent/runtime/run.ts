import { AgentTurnAuditCollector } from "../../runtime/audit/index.js";
import { getProviderFromEnv } from "../../llm/index.js";
import type { LlmProvider } from "../../llm/provider.js";
import { runCmd, type CmdResult } from "../../runner/runCmd.js";
import { runAgent as runCoreAgent } from "../../core/agent/runAgent.js";
import { defaultAgentPolicy, type AgentPolicy } from "../../core/agent/policy/policy.js";
import { createToolRegistry, loadToolRegistryWithDocs } from "../tools/registry.js";
import type { ToolSpec } from "../tools/types.js";
import type { AgentState } from "../types.js";
import type { HumanReviewFn, PlanChangeReviewFn } from "../../core/agent/contracts.js";
import type { AgentEvent } from "../../core/agent/events.js";

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
  provider?: LlmProvider;
  runCmdImpl?: (cmd: string, argv: string[], cwd: string) => Promise<CmdResult>;
  registry?: Record<string, ToolSpec<any>>;
  registryDeps?: Parameters<typeof createToolRegistry>[0];
  humanReview?: HumanReviewFn;
  requestPlanChangeReview?: PlanChangeReviewFn;
  onEvent?: (event: AgentEvent) => void;
}): Promise<{ ok: boolean; summary: string; auditPath?: string; patchPaths?: string[]; state: AgentState }> => {
  const provider = args.provider ?? getProviderFromEnv();
  const runCmdImpl = args.runCmdImpl ?? runCmd;
  const maxTurns = args.maxTurns ?? 16;
  const maxToolCallsPerTurn = args.maxToolCallsPerTurn ?? 4;
  const maxPatches = args.maxPatches ?? 8;
  const discovered = args.registry ? null : await loadToolRegistryWithDocs(args.registryDeps);
  const registry = args.registry ?? discovered?.registry ?? (await createToolRegistry(args.registryDeps));
  const policy =
    args.policy ??
    defaultAgentPolicy({
      maxSteps: maxTurns,
      maxActionsPerTask: maxToolCallsPerTurn,
      maxRetriesPerTask: 3,
      maxReplans: 3,
      allowedTools: Object.keys(registry)
    });

  const modelHint =
    provider.name === "dashscope_responses"
      ? process.env.DASHSCOPE_MODEL
      : provider.name === "openai_responses"
        ? process.env.OPENAI_MODEL
        : undefined;

  const reviewPort =
    args.humanReview || args.requestPlanChangeReview
      ? {
          humanReview: args.humanReview,
          requestPlanChangeReview: args.requestPlanChangeReview
        }
      : undefined;

  return runCoreAgent({
    goal: args.goal,
    specPath: args.specPath,
    outDir: args.outDir,
    apply: args.apply,
    verify: args.verify,
    repair: args.repair,
    maxTurns,
    maxToolCallsPerTurn,
    maxPatches,
    truncation: args.truncation,
    compactionThreshold: args.compactionThreshold,
    policy,
    registry,
    llm: provider,
    commandRunner: runCmdImpl,
    audit: new AgentTurnAuditCollector(args.goal),
    humanReview: reviewPort,
    modelHint,
    runtimeRepoRoot: process.cwd(),
    onEvent: args.onEvent
  });
};
