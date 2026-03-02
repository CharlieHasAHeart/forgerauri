import type { LlmProvider } from "../../llm/provider.js";
import type { PlanTask, PlanV1 } from "../plan/schema.js";
import { summarizePlan } from "../plan/selectors.js";
import { proposeToolCallsForTask } from "../planning/tool_call_planner.js";
import type { AgentPolicy } from "../policy/policy.js";
import type { AgentState } from "../types.js";
import type { ToolRunContext, ToolSpec } from "../tools/types.js";
import type { AgentTurnAuditCollector } from "../../runtime/audit/index.js";
import { executeActionPlan, type HumanReviewFn } from "./executor.js";
import { setStateError } from "./errors.js";
import type { AgentEvent } from "./events.js";
import { recordTaskActionPlan } from "./recorder.js";
import { summarizeState } from "./state.js";
import { gateToolCalls } from "./toolcall_gate.js";

const parseMaybeJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("\""))) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
};

const toPositiveInt = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === "string") {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
};

const PLANNER_OUTPUT_INVALID_RETRY_HINT =
  "PlannerOutputInvalid: toolCalls must be array of {name,input}. input must be a JSON object (not undefined). Fix and return valid tool calls.";

export const runTaskAttempt = async (args: {
  turn: number;
  goal: string;
  provider: LlmProvider;
  policy: AgentPolicy;
  task: PlanTask;
  currentPlan: PlanV1;
  completed: Set<string>;
  recentFailures: string[];
  state: AgentState;
  registry: Record<string, ToolSpec<any>>;
  ctx: ToolRunContext;
  maxToolCallsPerTurn: number;
  audit: AgentTurnAuditCollector;
  humanReview?: HumanReviewFn;
  onEvent?: (event: AgentEvent) => void;
}): Promise<{
  ok: boolean;
  failures: string[];
  toolCalls: Array<{ name: string; input: unknown }>;
  turnAuditResults: Array<{ name: string; ok: boolean; error?: string; touchedPaths?: string[] }>;
}> => {
  const planSummary = summarizePlan(args.currentPlan);
  const stateSummary = {
    ...(summarizeState(args.state) as Record<string, unknown>),
    currentTask: args.task
  };

  let toolCalls: Array<{ name: string; input: unknown }> = [];
  let plannerRaw = "";
  let plannerResponseId: string | undefined;
  let plannerUsage: unknown;
  let plannerPreviousResponseIdSent: string | undefined;
  const plannerRecentFailures = [...args.recentFailures];

  for (let planTry = 1; planTry <= 2; planTry += 1) {
    try {
      const proposal = await proposeToolCallsForTask({
        goal: args.goal,
        provider: args.provider,
        policy: args.policy,
        task: args.task,
        planSummary,
        stateSummary,
        registry: args.registry,
        recentFailures: plannerRecentFailures,
        maxToolCallsPerTurn: args.maxToolCallsPerTurn,
        previousResponseId: args.state.lastResponseId,
        truncation: args.state.flags.truncation,
        contextManagement:
          typeof args.state.flags.compactionThreshold === "number"
            ? [{ type: "compaction", compactThreshold: args.state.flags.compactionThreshold }]
            : undefined
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

  // Deterministic injection for bootstrap tool required inputs
  toolCalls = toolCalls.map((call) => {
    const rawInput = (call as { input: unknown }).input;
    const inputObj = rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};
    const runtimeSpecPath = args.ctx.memory.specPath ?? args.state.specPath;
    const runtimeOutDir = args.ctx.memory.outDir ?? args.state.outDir;
    const runtimeProjectRoot = args.state.appDir ?? args.state.projectRoot;
    const runtimeApply = args.state.flags.apply;

    switch (call.name) {
      case "tool_bootstrap_project":
        // Bootstrap path/apply are runtime truths; never trust model-provided values here.
        inputObj.specPath = runtimeSpecPath;
        inputObj.outDir = runtimeOutDir;
        inputObj.apply = runtimeApply;
        break;
      case "tool_design_contract":
        inputObj.specPath = runtimeSpecPath;
        if (runtimeProjectRoot) inputObj.projectRoot = runtimeProjectRoot;
        break;
      case "tool_design_ux":
        inputObj.specPath = runtimeSpecPath;
        if (runtimeProjectRoot) inputObj.projectRoot = runtimeProjectRoot;
        inputObj.contract = parseMaybeJson(inputObj.contract);
        if (
          (!inputObj.contract || typeof inputObj.contract !== "object" || Array.isArray(inputObj.contract)) &&
          args.state.contract
        ) {
          inputObj.contract = args.state.contract;
        }
        break;
      case "tool_design_implementation":
        inputObj.contract = parseMaybeJson(inputObj.contract);
        if (
          (!inputObj.contract || typeof inputObj.contract !== "object" || Array.isArray(inputObj.contract)) &&
          args.state.contract
        ) {
          inputObj.contract = args.state.contract;
        }
        inputObj.ux = parseMaybeJson(inputObj.ux);
        if ((!inputObj.ux || typeof inputObj.ux !== "object" || Array.isArray(inputObj.ux)) && args.state.ux) {
          inputObj.ux = args.state.ux;
        }
        if (runtimeSpecPath && (inputObj as Record<string, unknown>).specPath === undefined) {
          (inputObj as Record<string, unknown>).specPath = runtimeSpecPath;
        }
        if (runtimeProjectRoot) inputObj.projectRoot = runtimeProjectRoot;
        break;
      case "tool_design_delivery":
        inputObj.contract = parseMaybeJson(inputObj.contract);
        if (
          (!inputObj.contract || typeof inputObj.contract !== "object" || Array.isArray(inputObj.contract)) &&
          args.state.contract
        ) {
          inputObj.contract = args.state.contract;
        }
        if (runtimeProjectRoot) inputObj.projectRoot = runtimeProjectRoot;
        break;
      case "tool_materialize_contract":
        inputObj.contract = parseMaybeJson(inputObj.contract);
        if (
          (!inputObj.contract || typeof inputObj.contract !== "object" || Array.isArray(inputObj.contract)) &&
          args.state.contract
        ) {
          inputObj.contract = args.state.contract;
        }
        inputObj.outDir = runtimeOutDir;
        inputObj.apply = runtimeApply;
        if (runtimeProjectRoot) inputObj.appDir = runtimeProjectRoot;
        break;
      case "tool_materialize_ux":
        inputObj.ux = parseMaybeJson(inputObj.ux);
        if ((!inputObj.ux || typeof inputObj.ux !== "object" || Array.isArray(inputObj.ux)) && args.state.ux) {
          inputObj.ux = args.state.ux;
        }
        if (runtimeProjectRoot) inputObj.projectRoot = runtimeProjectRoot;
        inputObj.apply = runtimeApply;
        break;
      case "tool_materialize_implementation":
        inputObj.impl = parseMaybeJson(inputObj.impl);
        if ((!inputObj.impl || typeof inputObj.impl !== "object" || Array.isArray(inputObj.impl)) && args.state.impl) {
          inputObj.impl = args.state.impl;
        }
        if (runtimeProjectRoot) inputObj.projectRoot = runtimeProjectRoot;
        inputObj.apply = runtimeApply;
        break;
      case "tool_materialize_delivery":
        inputObj.delivery = parseMaybeJson(inputObj.delivery);
        if (
          (!inputObj.delivery || typeof inputObj.delivery !== "object" || Array.isArray(inputObj.delivery)) &&
          args.state.delivery
        ) {
          inputObj.delivery = args.state.delivery;
        }
        if (runtimeProjectRoot) inputObj.projectRoot = runtimeProjectRoot;
        inputObj.apply = runtimeApply;
        break;
      case "tool_validate_design":
      case "tool_codegen_from_design":
      case "tool_verify_project":
      case "tool_repair_known_issues":
        if (runtimeProjectRoot) inputObj.projectRoot = runtimeProjectRoot;
        inputObj.apply = runtimeApply;
        break;
      case "tool_repair_once":
        if (runtimeProjectRoot) inputObj.projectRoot = runtimeProjectRoot;
        break;
      case "tool_read_files": {
        if (runtimeProjectRoot) inputObj.projectRoot = runtimeProjectRoot;
        const globs = parseMaybeJson(inputObj.globs);
        if (Array.isArray(globs)) {
          inputObj.globs = globs.map((value) => String(value));
        }
        const maxChars = toPositiveInt(inputObj.maxChars);
        if (maxChars !== undefined) {
          inputObj.maxChars = maxChars;
        }
        break;
      }
      default:
        break;
    }

    return { ...call, input: inputObj };
  });

  const actionPlanActions = toolCalls.map((item) => ({ name: item.name }));
  args.state.status = "executing";

  const executed = await executeActionPlan({
    toolCalls,
    actionPlanActions,
    registry: args.registry,
    ctx: args.ctx,
    state: args.state,
    policy: args.policy,
    humanReview: args.humanReview,
    task: args.task,
    onEvent: args.onEvent
  });

  // Sync appDir after bootstrap (tool writes ctx.memory.appDir on success)
  if (args.ctx.memory.appDir && (!args.state.appDir || args.state.appDir !== args.ctx.memory.appDir)) {
    args.state.appDir = args.ctx.memory.appDir;
    // args.state.projectRoot = args.state.projectRoot ?? args.ctx.memory.appDir;
  }

  recordTaskActionPlan({
    audit: args.audit,
    turn: args.turn,
    taskId: args.task.id,
    llmRaw: plannerRaw,
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
