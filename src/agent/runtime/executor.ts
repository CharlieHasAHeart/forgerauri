// Executes task action plans via tools and runs criteria checks.
import { randomUUID } from "node:crypto";
import type { AgentPolicy } from "../policy/policy.js";
import type { PlanTask } from "../plan/schema.js";
import type { AgentState, AgentStatus } from "../types.js";
import { evaluateSuccessCriteriaWithTools } from "../evaluation/reviewer.js";
import type { ToolRunContext, ToolSpec } from "../tools/types.js";
import { setStateError, truncate } from "./errors.js";
import type { AgentEvent } from "./events.js";
import { summarizeForEvidence, tail, type EvidenceEvent } from "../core/evidence.js";
import { readEvidenceJsonlWithDiagnostics } from "../core/evidence_reader.js";
import { createSnapshot } from "../core/workspace_snapshot.js";
import { evaluateAcceptanceRuntime } from "./evaluate_acceptance_runtime.js";
import { DEFAULT_ACCEPTANCE_PIPELINE_ID } from "../core/acceptance_catalog.js";

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

const safeInt = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;

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
  const callId = randomUUID();
  const startedAt = new Date().toISOString();
  const runId = ctx.memory.evidenceRunId;
  const turn = ctx.memory.evidenceTurn;
  const taskId = ctx.memory.evidenceTaskId;
  const evidenceLogger = ctx.memory.evidenceLogger;
  const canLogEvidence = Boolean(evidenceLogger && runId && turn !== undefined && taskId);

  const appendEvidence = (event: EvidenceEvent): void => {
    if (!canLogEvidence || !evidenceLogger) return;
    evidenceLogger.append(event);
  };

  const buildToolReturnedEvent = (args2: {
    ok: boolean;
    note?: string;
    touchedPaths?: string[];
    resultData?: unknown;
    exitCode?: number;
  }): EvidenceEvent | null => {
    if (!canLogEvidence || !runId || turn === undefined || !taskId) return null;
    return {
      event_type: "tool_returned",
      run_id: runId,
      turn,
      task_id: taskId,
      call_id: callId,
      tool_name: call.name,
      ok: args2.ok,
      ended_at: new Date().toISOString(),
      note: args2.note ? summarizeForEvidence(args2.note) : undefined,
      touched_paths: args2.touchedPaths ?? [],
      output_summary: args2.resultData === undefined ? undefined : summarizeForEvidence(args2.resultData),
      exit_code: args2.exitCode
    };
  };

  const finish = (args2: {
    ok: boolean;
    note?: string;
    touchedPaths: string[];
    resultData?: unknown;
    exitCode?: number;
  }): ExecutedToolCall => {
    const toolReturned = buildToolReturnedEvent({
      ok: args2.ok,
      note: args2.note,
      touchedPaths: args2.touchedPaths,
      resultData: args2.resultData,
      exitCode: args2.exitCode
    });
    if (toolReturned) appendEvidence(toolReturned);
    return {
      ok: args2.ok,
      note: args2.note,
      touchedPaths: args2.touchedPaths,
      resultData: args2.resultData,
      toolName: call.name
    };
  };

  const maybeAppendCommandRan = (resultData: unknown, ok: boolean): void => {
    if (!canLogEvidence || !runId || turn === undefined || !taskId || call.name !== "tool_run_cmd") return;
    if (!resultData || typeof resultData !== "object") return;
    const data = resultData as Record<string, unknown>;
    const parsedInput = parsed.success && parsed.data && typeof parsed.data === "object" ? (parsed.data as Record<string, unknown>) : {};
    const cmd = typeof parsedInput.cmd === "string" ? parsedInput.cmd : "";
    const args = Array.isArray(parsedInput.args) ? parsedInput.args.map((item) => String(item)) : [];
    const cwd = typeof parsedInput.cwd === "string" ? parsedInput.cwd : "";
    const exitCode = safeInt(data.code ?? data.exitCode);
    if (!cmd || !cwd || exitCode === undefined) return;
    appendEvidence({
      event_type: "command_ran",
      run_id: runId,
      turn,
      task_id: taskId,
      call_id: callId,
      cmd,
      args,
      cwd,
      ok,
      exit_code: exitCode,
      stdout_tail: typeof data.stdout === "string" ? tail(data.stdout) : undefined,
      stderr_tail: typeof data.stderr === "string" ? tail(data.stderr) : undefined,
      at: new Date().toISOString()
    });
  };

  if (canLogEvidence && runId && turn !== undefined && taskId) {
    appendEvidence({
      event_type: "tool_called",
      run_id: runId,
      turn,
      task_id: taskId,
      call_id: callId,
      tool_name: call.name,
      input: summarizeForEvidence(call.input),
      started_at: startedAt
    });
  }

  if (!policy.safety.allowed_tools.includes(call.name)) {
    const note = `tool ${call.name} is blocked by policy`;
    setStateError(state, "Config", note);
    return finish({ ok: false, note, touchedPaths: [] });
  }

  const tool = registry[call.name] as ToolSpec | undefined;
  if (!tool) {
    const note = `unknown tool ${call.name}`;
    setStateError(state, "Unknown", note);
    return finish({ ok: false, note, touchedPaths: [] });
  }

  const parsed = tool.inputSchema.safeParse(call.input);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    setStateError(state, "Config", detail);
    return finish({ ok: false, note: detail, touchedPaths: [] });
  }

  let result: Awaited<ReturnType<typeof tool.run>>;
  try {
    result = await tool.run(parsed.data, ctx);
  } catch (error) {
    const note = `tool ${call.name} threw: ${error instanceof Error ? error.message : String(error)}`;
    setStateError(state, "Unknown", note);
    return finish({ ok: false, note, touchedPaths: [] });
  }
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
      return finish({
        ok: false,
        note: state.lastError?.message,
        touchedPaths: touched,
        resultData: result.data,
        exitCode: safeInt((result.data as Record<string, unknown> | undefined)?.exitCode ?? (result.data as Record<string, unknown> | undefined)?.code)
      });
    }
  }

  if (!result.ok) {
    setStateError(
      state,
      "Unknown",
      `${result.error?.message ?? "tool failed"}${result.error?.detail ? ` (${truncate(result.error.detail)})` : ""}`
    );
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

  maybeAppendCommandRan(result.data, result.ok);

  if (call.name === "tool_verify_project") {
    try {
      const evidenceFilePath = `${ctx.memory.outDir ?? state.outDir}/run_evidence.jsonl`;
      const evidenceRead = await readEvidenceJsonlWithDiagnostics(evidenceFilePath);
      const runtimeAppDir = ctx.memory.runtimePaths?.appDir ?? ctx.memory.appDir ?? state.runtimePaths?.appDir ?? state.appDir;
      const runtimeRepoRoot =
        ctx.memory.runtimePaths?.repoRoot ?? ctx.memory.repoRoot ?? state.runtimePaths?.repoRoot ?? process.cwd();
      const runtimeTauriDir =
        ctx.memory.runtimePaths?.tauriDir ?? ctx.memory.tauriDir ?? state.runtimePaths?.tauriDir ?? `${runtimeAppDir ?? "./generated/app"}/src-tauri`;
      const snapshot = await createSnapshot(runtimeRepoRoot, { paths: [] });
      const acceptance = evaluateAcceptanceRuntime({
        goal: state.goal,
        intent: { type: "verify_acceptance_pipeline", pipeline_id: DEFAULT_ACCEPTANCE_PIPELINE_ID },
        ctx,
        state,
        evidence: evidenceRead.events,
        snapshot
      });
      const acceptanceDiagnostics = [
        ...evidenceRead.diagnostics.map((item) => `evidence: ${item}`),
        ...acceptance.diagnostics.map((item) => `acceptance: ${item}`)
      ];
      state.lastDeterministicFixes = acceptanceDiagnostics.slice(-20);
      ctx.memory.runtimePaths = {
        repoRoot: runtimeRepoRoot,
        appDir: runtimeAppDir ?? "./generated/app",
        tauriDir: runtimeTauriDir
      };
      state.runtimePaths = ctx.memory.runtimePaths;
    } catch (error) {
      state.lastDeterministicFixes = [
        ...(state.lastDeterministicFixes ?? []),
        `acceptance runtime evaluation failed: ${error instanceof Error ? error.message : String(error)}`
      ].slice(-20);
    }
  }

  return finish({
    ok: result.ok,
    note: result.ok ? "ok" : state.lastError?.message,
    touchedPaths: touched,
    resultData: result.data,
    exitCode: safeInt((result.data as Record<string, unknown> | undefined)?.exitCode ?? (result.data as Record<string, unknown> | undefined)?.code)
  });
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
