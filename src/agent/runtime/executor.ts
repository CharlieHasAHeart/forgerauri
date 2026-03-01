// Executes task action plans via tools and runs criteria checks.
import type { AgentPolicy } from "../policy/policy.js";
import type { PlanTask } from "../plan/schema.js";
import type { AgentState, AgentStatus } from "../types.js";
import { evaluateSuccessCriteriaWithTools } from "../evaluation/reviewer.js";
import type { ToolRunContext, ToolSpec } from "../tools/types.js";
import { setStateError, truncate } from "./errors.js";
import type { AgentEvent } from "./events.js";

export type HumanReviewFn = (args: { reason: string; patchPaths: string[]; phase: AgentStatus }) => Promise<boolean>;

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

export const executeToolCall = async (args: {
  call: { name: string; input: unknown };
  registry: Record<string, ToolSpec<any>>;
  ctx: ToolRunContext;
  state: AgentState;
  policy: AgentPolicy;
  humanReview?: HumanReviewFn;
  onEvent?: (event: AgentEvent) => void;
}): Promise<ExecutedToolCall> => {
  const { call, registry, ctx, state, policy, humanReview } = args;

  if (!policy.safety.allowed_tools.includes(call.name)) {
    const note = `tool ${call.name} is blocked by policy`;
    setStateError(state, "Config", note);
    return { ok: false, note, touchedPaths: [], toolName: call.name };
  }

  const tool = registry[call.name] as ToolSpec | undefined;
  if (!tool) {
    const note = `unknown tool ${call.name}`;
    setStateError(state, "Unknown", note);
    return { ok: false, note, touchedPaths: [], toolName: call.name };
  }

  const parsed = tool.inputSchema.safeParse(call.input);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    setStateError(state, "Config", detail);
    return { ok: false, note: detail, touchedPaths: [], toolName: call.name };
  }

  const result = await tool.run(parsed.data, ctx);
  const touched = result.meta?.touchedPaths ?? [];

  const beforePatches = new Set(state.patchPaths);
  state.touchedFiles = Array.from(new Set([...state.touchedFiles, ...touched]));
  state.patchPaths = Array.from(new Set([...state.patchPaths, ...ctx.memory.patchPaths]));
  const newPatchPaths = state.patchPaths.filter((path) => !beforePatches.has(path));

  if (newPatchPaths.length > 0 && humanReview) {
    args.onEvent?.({ type: "patch_generated", paths: newPatchPaths });
    const approved = await humanReview({
      reason: "Generated PATCH files require manual merge",
      patchPaths: newPatchPaths,
      phase: state.status
    });
    state.humanReviews.push({ reason: "Generated PATCH files require manual merge", approved, patchPaths: newPatchPaths });
    if (!approved) {
      setStateError(state, "Config", "Human review rejected automatic continuation after PATCH generation");
      return { ok: false, note: state.lastError?.message, touchedPaths: touched, resultData: result.data, toolName: call.name };
    }
  }

  if (!result.ok) {
    setStateError(
      state,
      "Unknown",
      `${result.error?.message ?? "tool failed"}${result.error?.detail ? ` (${truncate(result.error.detail)})` : ""}`
    );
  }

  return {
    ok: result.ok,
    note: result.ok ? "ok" : state.lastError?.message,
    touchedPaths: touched,
    resultData: result.data,
    toolName: call.name
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
