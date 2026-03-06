import type { PlanTask, PlanV2, Planner, ToolCall } from "../../contracts/planning.js";
import type { AgentPolicy } from "../../contracts/policy.js";
import type { RuntimePathsResolver } from "../../contracts/runtime.js";
import type { AgentState } from "../../contracts/state.js";
import type { ToolRunContext, ToolSpec } from "../../contracts/tools.js";
import type { KernelHooks } from "../../contracts/hooks.js";
import type { Workspace } from "../../contracts/workspace.js";
import type { AgentTurnAuditCollector } from "../telemetry/audit.js";
import { executeActionPlan } from "../execution/executor.js";
import { setStateError } from "../execution/errors.js";
import type { AgentEvent } from "../telemetry/events.js";
import { recordTaskActionPlan } from "../telemetry/recorder.js";
import { gateToolCalls } from "../policy/toolcall_gate.js";
import { ContextEngine } from "../../context_engine/ContextEngine.js";
import { serializeContextPacket } from "../../contracts/context.js";
import { storeBlob } from "../../utils/blobStore.js";

const PLANNER_OUTPUT_INVALID_RETRY_HINT =
  "PlannerOutputInvalid: toolCalls must be array of {name,input}. input must be a JSON value (not undefined). Fix and return valid tool calls.";

export const runTaskAttempt = async (args: {
  turn: number;
  planner: Planner;
  policy: AgentPolicy;
  task: PlanTask;
  currentPlan: PlanV2;
  completed: Set<string>;
  recentFailures: string[];
  state: AgentState;
  registry: Record<string, ToolSpec<any>>;
  ctx: ToolRunContext;
  maxToolCallsPerTurn: number;
  runtimePathsResolver: RuntimePathsResolver;
  hooks?: KernelHooks;
  audit: AgentTurnAuditCollector;
  contextEngine: ContextEngine;
  workspace: Workspace;
  onEvent?: (event: AgentEvent) => void;
}): Promise<{
  ok: boolean;
  failures: string[];
  toolCalls: ToolCall[];
  turnAuditResults: Array<{ name: string; ok: boolean; error?: string; touchedPaths?: string[] }>;
}> => {
  const runtimePaths = args.runtimePathsResolver(args.ctx, args.state);
  args.ctx.memory.repoRoot = runtimePaths.repoRoot;
  args.ctx.memory.appDir = runtimePaths.appDir;
  args.ctx.memory.tauriDir = runtimePaths.tauriDir;
  args.ctx.memory.runtimePaths = runtimePaths;
  args.state.runtimePaths = runtimePaths;
  args.state.appDir = runtimePaths.appDir;

  let toolCalls: ToolCall[] = [];
  let plannerRaw = "";
  let plannerResponseId: string | undefined;
  let plannerUsage: unknown;
  let plannerPreviousResponseIdSent: string | undefined;
  let plannerContextRef: string | undefined;
  const plannerRecentFailures = [...args.recentFailures];

  for (let planTry = 1; planTry <= 2; planTry += 1) {
    try {
      let proposal: {
        toolCalls: ToolCall[];
        raw: string;
        responseId?: string;
        usage?: unknown;
        previousResponseIdSent?: string;
      };
      const packet = await args.contextEngine.buildContextPacket({
        phase: "toolcall",
        turn: args.turn,
        state: args.state,
        ctx: args.ctx,
        registry: args.registry,
        policy: args.policy,
        workspace: args.workspace,
        task: args.task,
        plan: args.currentPlan,
        failures: plannerRecentFailures
      });
      const serialized = serializeContextPacket(packet);
      plannerContextRef = storeBlob(args.ctx, serialized, "context");
      proposal = await args.planner.proposeToolCallsForTask({
        context: packet,
        task: args.task,
        registry: args.registry,
        policy: args.policy
      });

      plannerRaw = proposal.raw;
      plannerResponseId = proposal.responseId;
      plannerUsage = proposal.usage;
      plannerPreviousResponseIdSent = proposal.previousResponseIdSent;
      args.state.lastResponseId = proposal.responseId ?? args.state.lastResponseId;

      const gated = gateToolCalls({
        toolCalls: proposal.toolCalls,
        maxToolCallsPerTurn: args.maxToolCallsPerTurn,
        policyMaxActionsPerTask: args.policy.budgets.max_actions_per_task
      });

      if (gated.ok) {
        toolCalls = gated.toolCalls;
        break;
      }

      plannerRecentFailures.push(PLANNER_OUTPUT_INVALID_RETRY_HINT);

      if (planTry >= 2) {
        args.state.status = "failed";
        setStateError(args.state, "Config", gated.details);
        return {
          ok: false,
          failures: [gated.details],
          toolCalls: [],
          turnAuditResults: []
        };
      }
    } catch (error) {
      const message = `Failed to propose tool calls for task '${args.task.id}': ${
        error instanceof Error ? error.message : "unknown error"
      }`;
      if (planTry >= 2) {
        args.state.status = "failed";
        setStateError(args.state, "Unknown", message);
        return {
          ok: false,
          failures: [message],
          toolCalls: [],
          turnAuditResults: []
        };
      }
      plannerRecentFailures.push(PLANNER_OUTPUT_INVALID_RETRY_HINT);
    }
  }

  const actionPlanActions = toolCalls.map((item) => ({ name: item.name }));
  args.state.status = "executing";

  const executed = await executeActionPlan({
    toolCalls,
    actionPlanActions,
    registry: args.registry,
    ctx: args.ctx,
    state: args.state,
    policy: args.policy,
    hooks: args.hooks,
    task: args.task,
    onEvent: args.onEvent
  });

  const nextRuntimePaths = args.runtimePathsResolver(args.ctx, args.state);
  args.ctx.memory.runtimePaths = nextRuntimePaths;
  args.state.runtimePaths = nextRuntimePaths;

  recordTaskActionPlan({
    audit: args.audit,
    turn: args.turn,
    taskId: args.task.id,
    llmRaw: plannerRaw,
    contextPacketRef: plannerContextRef,
    evidenceRef: args.state.lastEvidence?.stderrRef ?? args.state.lastEvidence?.stdoutRef,
    previousResponseIdSent: plannerPreviousResponseIdSent,
    responseId: plannerResponseId,
    usage: plannerUsage,
    toolCalls,
    toolResults: executed.turnAuditResults
  });

  return {
    ok: executed.criteria.ok,
    failures: executed.criteria.failures,
    toolCalls,
    turnAuditResults: executed.turnAuditResults
  };
};
