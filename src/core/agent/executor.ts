import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentPolicy } from "../contracts/policy.js";
import type { PlanTask, SuccessCriterion, ToolCall } from "../contracts/planning.js";
import type { AgentState } from "../contracts/state.js";
import type { ToolRunContext, ToolSpec } from "../contracts/tools.js";
import { setStateError, truncate } from "./errors.js";
import type { AgentEvent } from "./events.js";
import type { HumanReviewFn as HumanReviewFnType } from "./contracts.js";

export type HumanReviewFn = HumanReviewFnType;

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

const evaluateCriterion = async (args: {
  criterion: SuccessCriterion;
  toolResults: Array<{ name: string; ok: boolean }>;
  ctx: ToolRunContext;
  state: AgentState;
}): Promise<{ ok: boolean; failure?: string; toolAudit?: { name: string; ok: boolean; error?: string } }> => {
  const c = args.criterion;

  if (c.type === "tool_result") {
    const matched = args.toolResults.filter((result) => result.name === c.tool_name);
    if (matched.length === 0) {
      return { ok: false, failure: `criteria check failed: ${c.tool_name}` };
    }
    const expected = c.expected_ok ?? true;
    const ok = matched.some((item) => item.ok === expected);
    return ok ? { ok: true } : { ok: false, failure: `criteria check failed: ${c.tool_name}` };
  }

  if (c.type === "file_exists") {
    const base = args.state.appDir ?? args.ctx.memory.appDir ?? args.state.outDir;
    const target = join(base, c.path);
    try {
      await readFile(target);
      return { ok: true };
    } catch {
      return { ok: false, failure: "criteria check failed: tool_check_file_exists" };
    }
  }

  if (c.type === "file_contains") {
    const base = args.state.appDir ?? args.ctx.memory.appDir ?? args.state.outDir;
    const target = join(base, c.path);
    try {
      const content = await readFile(target, "utf8");
      if (content.includes(c.contains)) return { ok: true };
      return { ok: false, failure: "criteria check failed: tool_check_file_contains" };
    } catch {
      return { ok: false, failure: "criteria check failed: tool_check_file_contains" };
    }
  }

  if (c.type === "command") {
    const cwd = c.cwd ?? args.state.appDir ?? args.ctx.memory.appDir ?? args.state.outDir;
    const result = await args.ctx.runCmdImpl(c.cmd, c.args ?? [], cwd);
    const expected = c.expect_exit_code ?? 0;
    if (result.code === expected && result.ok) return { ok: true };
    return {
      ok: false,
      failure: `criteria check failed: command ${c.cmd}`,
      toolAudit: { name: `${c.cmd} ${String(c.args ?? []).trim()}`, ok: false, error: result.stderr || result.stdout }
    };
  }

  return { ok: false, failure: "criteria check failed: unknown criterion" };
};

export const executeToolCall = async (args: {
  call: ToolCall;
  registry: Record<string, ToolSpec<any>>;
  ctx: ToolRunContext;
  state: AgentState;
  policy: AgentPolicy;
  humanReview?: HumanReviewFn;
  onEvent?: (event: AgentEvent) => void;
}): Promise<ExecutedToolCall> => {
  const { call, state, humanReview } = args;

  if (!args.policy.safety.allowed_tools.includes(call.name)) {
    const note = `tool ${call.name} blocked by policy`;
    setStateError(state, "Config", note);
    return { ok: false, note, touchedPaths: [], toolName: call.name };
  }

  const tool = args.registry[call.name];
  if (!tool) {
    const note = `unknown tool ${call.name}`;
    setStateError(state, "Unknown", note);
    return { ok: false, note, touchedPaths: [], toolName: call.name };
  }

  let parsedInput: unknown = call.input;
  if (tool.inputSchema) {
    try {
      parsedInput = tool.inputSchema.parse(call.input);
    } catch (error) {
      const note = `tool ${call.name} input invalid: ${error instanceof Error ? truncate(error.message, 240) : "invalid input"}`;
      setStateError(state, "Config", note);
      return { ok: false, note, touchedPaths: [], toolName: call.name };
    }
  }

  let result: Awaited<ReturnType<typeof tool.run>>;
  try {
    result = await tool.run(parsedInput as never, args.ctx);
  } catch (error) {
    const note = `tool ${call.name} threw: ${error instanceof Error ? error.message : String(error)}`;
    setStateError(state, "Unknown", note);
    return { ok: false, note, touchedPaths: [], toolName: call.name };
  }

  const touched = result.meta?.touchedPaths ?? [];
  state.touchedFiles = Array.from(new Set([...state.touchedFiles, ...touched]));
  state.patchPaths = Array.from(new Set([...state.patchPaths, ...args.ctx.memory.patchPaths]));

  if (state.patchPaths.length > state.budgets.maxPatches) {
    setStateError(state, "Config", `Patch budget exceeded: ${state.patchPaths.length} > ${state.budgets.maxPatches}`);
    return { ok: false, note: state.lastError?.message, touchedPaths: touched, resultData: result.data, toolName: call.name };
  }

  if (state.patchPaths.length > 0 && humanReview) {
    const approved = await humanReview({
      reason: "Generated PATCH files require manual merge",
      patchPaths: state.patchPaths,
      phase: state.status
    });
    state.humanReviews.push({ reason: "Generated PATCH files require manual merge", approved, patchPaths: state.patchPaths, phase: state.status });
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
    setStateError(
      state,
      "Unknown",
      `${result.error?.message ?? "tool failed"}${result.error?.detail ? ` (${truncate(result.error.detail)})` : ""}`,
      result.error?.code
    );
  } else if (result.data && typeof result.data === "object") {
    const payload = result.data as Record<string, unknown>;
    if (call.name === "tool_design_contract" && payload.contract && typeof payload.contract === "object") {
      state.contract = payload.contract;
    } else if (call.name === "tool_design_ux" && payload.ux && typeof payload.ux === "object") {
      state.ux = payload.ux;
    } else if (call.name === "tool_design_implementation" && payload.impl && typeof payload.impl === "object") {
      state.impl = payload.impl;
    } else if (call.name === "tool_design_delivery" && payload.delivery && typeof payload.delivery === "object") {
      state.delivery = payload.delivery;
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

export const executeActionPlan = async (args: {
  toolCalls: ToolCall[];
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

  const failures: string[] = [];
  const criteriaToolAudit: Array<{ name: string; ok: boolean; error?: string }> = [];

  for (const criterion of args.task.success_criteria) {
    const verdict = await evaluateCriterion({
      criterion,
      toolResults: simpleToolResults,
      ctx: args.ctx,
      state: args.state
    });
    if (!verdict.ok && verdict.failure) {
      failures.push(verdict.failure);
    }
    if (verdict.toolAudit) {
      criteriaToolAudit.push(verdict.toolAudit);
    }
  }

  turnAuditResults.push(...criteriaToolAudit.map((item) => ({ name: item.name, ok: item.ok, error: item.error })));

  return {
    turnAuditResults,
    simpleToolResults,
    criteria: {
      ok: failures.length === 0,
      failures,
      toolAudit: criteriaToolAudit
    }
  };
};
