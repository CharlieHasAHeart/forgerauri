// Executes task action plans via composed tool middlewares and runs criteria checks.
import { composeMiddlewares } from "../../agent/middleware/compose.js";
import { acceptanceGateMiddleware } from "../../agent/middleware/tool/acceptance_gate_middleware.js";
import { evidenceMiddleware } from "../../agent/middleware/tool/evidence_middleware.js";
import { policyMiddleware } from "../../agent/middleware/tool/policy_middleware.js";
import { runtimePathsMiddleware } from "../../agent/middleware/tool/runtime_paths_middleware.js";
import { schemaMiddleware } from "../../agent/middleware/tool/schema_middleware.js";
import type { ToolCallContext, ToolCallResult } from "../../agent/middleware/tool/types.js";
import type { AgentPolicy } from "./policy/policy.js";
import type { PlanTask } from "../../agent/plan/schema.js";
import type { AgentState } from "../../agent/types.js";
import { evaluateSuccessCriteriaWithTools } from "../../agent/evaluation/reviewer.js";
import type { ToolRunContext, ToolSpec } from "../../agent/tools/types.js";
import { setStateError, truncate } from "./errors.js";
import type { AgentEvent } from "./events.js";
import type { HumanReviewFn } from "./contracts.js";

export type { HumanReviewFn } from "./contracts.js";

export type ExecutedToolCall = {
  ok: boolean;
  note?: string;
  touchedPaths: string[];
  resultData?: unknown;
  toolName: string;
};

const normalizeToolResults = (toolName: string, ok: boolean, note?: string): { name: string; ok: boolean; note?: string } => ({
  name: toolName,
  ok,
  note
});

const executeToolCore = async (context: ToolCallContext): Promise<ToolCallResult> => {
  const { call, state, humanReview } = context;
  const tool = context.tool;
  if (!tool) {
    const note = `tool missing in execution context: ${call.name}`;
    setStateError(state, "Unknown", note);
    return { ok: false, note, touchedPaths: [], toolName: call.name };
  }

  let result: Awaited<ReturnType<typeof tool.run>>;
  try {
    result = await tool.run(context.parsedInput, context.ctx);
  } catch (error) {
    const note = `tool ${call.name} threw: ${error instanceof Error ? error.message : String(error)}`;
    setStateError(state, "Unknown", note);
    return { ok: false, note, touchedPaths: [], toolName: call.name };
  }

  context.toolRunResult = result;
  const touched = result.meta?.touchedPaths ?? [];

  const beforePatches = new Set(state.patchPaths);
  state.touchedFiles = Array.from(new Set([...state.touchedFiles, ...touched]));
  state.patchPaths = Array.from(new Set([...state.patchPaths, ...context.ctx.memory.patchPaths]));
  const newPatchPaths = state.patchPaths.filter((path) => !beforePatches.has(path));

  if (newPatchPaths.length > 0 && humanReview) {
    context.onEvent?.({ type: "patch_generated", paths: newPatchPaths });
    const approved = await humanReview({
      reason: "Generated PATCH files require manual merge",
      patchPaths: newPatchPaths,
      phase: state.status
    });
    state.humanReviews.push({ reason: "Generated PATCH files require manual merge", approved, patchPaths: newPatchPaths });
    if (!approved) {
      setStateError(state, "Config", "Human review rejected automatic continuation after PATCH generation");
      return {
        ok: false,
        note: state.lastError?.message,
        touchedPaths: touched,
        resultData: result.data,
        toolName: call.name
      };
    }
  }

  if (!result.ok) {
    if (result.error?.code === "VERIFY_ACCEPTANCE_FAILED") {
      state.lastError = {
        kind: "Config",
        code: "VERIFY_ACCEPTANCE_FAILED",
        message: `${result.error?.message ?? "tool failed"}${result.error?.detail ? ` (${truncate(result.error.detail)})` : ""}`
      };
    } else {
      setStateError(
        state,
        "Unknown",
        `${result.error?.message ?? "tool failed"}${result.error?.detail ? ` (${truncate(result.error.detail)})` : ""}`
      );
    }
  } else if (result.data && typeof result.data === "object") {
    const payload = result.data as Record<string, unknown>;
    if (call.name === "tool_design_contract" && payload.contract && typeof payload.contract === "object") {
      state.contract = payload.contract as typeof state.contract;
    } else if (call.name === "tool_design_ux" && payload.ux && typeof payload.ux === "object") {
      state.ux = payload.ux as typeof state.ux;
    } else if (call.name === "tool_design_implementation" && payload.impl && typeof payload.impl === "object") {
      state.impl = payload.impl as typeof state.impl;
    } else if (call.name === "tool_design_delivery" && payload.delivery && typeof payload.delivery === "object") {
      state.delivery = payload.delivery as typeof state.delivery;
    }
  }

  return {
    ok: result.ok,
    note: result.ok ? "ok" : state.lastError?.message,
    touchedPaths: touched,
    resultData: result.data,
    toolName: call.name
  };
};

const buildToolCallHandler = () =>
  composeMiddlewares<ToolCallContext, ToolCallResult>(
    [runtimePathsMiddleware, evidenceMiddleware, policyMiddleware, schemaMiddleware, acceptanceGateMiddleware],
    executeToolCore
  );

export const executeToolCall = async (args: {
  call: { name: string; input: unknown };
  registry: Record<string, ToolSpec<any>>;
  ctx: ToolRunContext;
  state: AgentState;
  policy: AgentPolicy;
  humanReview?: HumanReviewFn;
  onEvent?: (event: AgentEvent) => void;
}): Promise<ExecutedToolCall> => {
  const handler = buildToolCallHandler();
  const result = await handler({
    call: args.call,
    registry: args.registry,
    ctx: args.ctx,
    state: args.state,
    policy: args.policy,
    humanReview: args.humanReview,
    onEvent: args.onEvent
  });

  return {
    ok: result.ok,
    note: result.note,
    touchedPaths: result.touchedPaths,
    resultData: result.resultData,
    toolName: result.toolName
  };
};

export const executeActionPlan = async (args: {
  toolCalls: Array<{ name: string; input: unknown }>;
  actionPlanActions: Array<{ name: string; on_fail?: "stop" | "continue" }>;
  registry: Record<string, ToolSpec<any>>;
  ctx: ToolRunContext;
  state: AgentState;
  policy: AgentPolicy;
  humanReview?: HumanReviewFn;
  task: PlanTask;
  onEvent?: (event: AgentEvent) => void;
}): Promise<{
  turnAuditResults: Array<{ name: string; ok: boolean; error?: string; touchedPaths?: string[] }>;
  simpleToolResults: Array<{ name: string; ok: boolean }>;
  criteria: { ok: boolean; failures: string[]; toolAudit: Array<{ name: string; ok: boolean; error?: string }> };
}> => {
  args.state.toolCalls = args.toolCalls;
  args.state.toolResults = [];

  const turnAuditResults: Array<{ name: string; ok: boolean; error?: string; touchedPaths?: string[] }> = [];
  const simpleToolResults: Array<{ name: string; ok: boolean }> = [];

  for (const call of args.toolCalls) {
    args.onEvent?.({ type: "tool_start", name: call.name });
    const executed = await executeToolCall({
      call,
      registry: args.registry,
      ctx: args.ctx,
      state: args.state,
      policy: args.policy,
      humanReview: args.humanReview,
      onEvent: args.onEvent
    });
    args.onEvent?.({ type: "tool_end", name: call.name, ok: executed.ok, note: executed.note });

    args.state.toolResults.push(normalizeToolResults(executed.toolName, executed.ok, executed.note));
    turnAuditResults.push({
      name: executed.toolName,
      ok: executed.ok,
      error: executed.ok ? undefined : executed.note,
      touchedPaths: executed.touchedPaths
    });
    simpleToolResults.push({ name: executed.toolName, ok: executed.ok });

    const actionRule = args.actionPlanActions.find((item) => item.name === call.name);
    if (!executed.ok && actionRule?.on_fail !== "continue") break;
  }

  args.state.status = "reviewing";
  const criteria = await evaluateSuccessCriteriaWithTools({
    task: args.task,
    toolResults: simpleToolResults,
    executeToolCall: (call) =>
      executeToolCall({
        call,
        registry: args.registry,
        ctx: args.ctx,
        state: args.state,
        policy: args.policy,
        humanReview: args.humanReview,
        onEvent: args.onEvent
      })
  });

  turnAuditResults.push(...criteria.toolAudit.map((item) => ({ name: item.name, ok: item.ok, error: item.error })));

  return { turnAuditResults, simpleToolResults, criteria };
};
