import { join, resolve } from "node:path";
import { AgentTurnAuditCollector } from "../runtime/audit/index.js";
import { proposeNextActions, proposePlan, proposePlanChange, proposeTaskActionPlan, renderToolIndex } from "./brain.js";
import { getNextReadyTask, summarizePlan } from "./plan/helpers.js";
import { applyPlanChangePatch } from "./plan/patch.js";
import { evaluatePlanChange } from "./plan/gate.js";
import type { PlanTask } from "./plan/schema.js";
import { defaultAgentPolicy, type AgentPolicy } from "./policy.js";
import { createToolRegistry, loadToolRegistryWithDocs } from "./tools/registry.js";
import { buildToolDocPack } from "./tools/loader.js";
import type { ToolRunContext, ToolSpec } from "./tools/types.js";
import { getProviderFromEnv } from "../llm/index.js";
import type { LlmProvider } from "../llm/provider.js";
import { runCmd, type CmdResult } from "../runner/runCmd.js";
import type { AgentState, ErrorKind, VerifyProjectResult } from "./types.js";

const truncate = (value: string, max = 4000): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

const PLAN_INSTRUCTIONS =
  "You are the planning brain for a coding agent. Always follow plan-first execution and produce strict JSON only.";

const classifyFromVerify = (result: VerifyProjectResult): ErrorKind => result.classifiedError;

const summarizeState = (state: AgentState): unknown => ({
  phase: state.phase,
  status: state.status,
  goal: state.goal,
  projectRoot: state.projectRoot,
  appDir: state.appDir,
  contractPath: state.contractPath,
  uxPath: state.uxPath,
  implPath: state.implPath,
  deliveryPath: state.deliveryPath,
  lastResponseId: state.lastResponseId,
  designValidation: state.designValidation,
  lastDeterministicFixes: state.lastDeterministicFixes,
  repairKnownChecked: state.repairKnownChecked,
  codegenSummary: state.codegenSummary,
  planVersion: state.planVersion,
  currentTaskId: state.currentTaskId,
  completedTasks: state.completedTasks,
  planSummary: state.planData ? summarizePlan(state.planData) : undefined,
  counts: {
    contractCommands: state.contract?.commands.length ?? 0,
    uxScreens: state.ux?.screens.length ?? 0,
    implServices: state.impl?.rust.services.length ?? 0,
    deliveryChecks: state.delivery?.preflight.checks.length ?? 0
  },
  flags: state.flags,
  budgets: state.budgets,
  verifyHistory: state.verifyHistory.map((item) => ({ ok: item.ok, step: item.step, summary: item.summary })),
  lastError: state.lastError,
  patchPaths: state.patchPaths,
  humanReviews: state.humanReviews,
  touchedFiles: state.touchedFiles.slice(-30)
});

const inferRepairCommand = (state: AgentState): { cmd: string; args: string[]; cwd: string } | null => {
  const latest = state.verifyHistory[state.verifyHistory.length - 1];
  const root = state.appDir;
  if (!latest || !root || latest.ok) return null;

  if (latest.step === "install" || latest.step === "install_retry") return { cmd: "pnpm", args: ["-C", root, "install"], cwd: root };
  if (latest.step === "build" || latest.step === "build_retry") return { cmd: "pnpm", args: ["-C", root, "build"], cwd: root };
  if (latest.step === "cargo_check") return { cmd: "cargo", args: ["check"], cwd: join(root, "src-tauri") };
  if (latest.step === "tauri_build") return { cmd: "pnpm", args: ["-C", root, "tauri", "build"], cwd: root };
  return { cmd: "pnpm", args: ["-C", root, "tauri", "--help"], cwd: root };
};

const normalizeToolResults = (toolName: string, ok: boolean, note?: string): { name: string; ok: boolean; note?: string } => ({
  name: toolName,
  ok,
  note
});

const requiredInput = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
};

const createVerifyCall = (projectRoot: string): { name: "tool_verify_project"; input: { projectRoot: string } } => ({
  name: "tool_verify_project",
  input: { projectRoot }
});

const createRepairOnceCall = (
  projectRoot: string,
  cmd: { cmd: string; args: string[] }
): { name: "tool_repair_once"; input: { projectRoot: string; cmd: string; args: string[] } } => ({
  name: "tool_repair_once",
  input: {
    projectRoot,
    cmd: cmd.cmd,
    args: cmd.args
  }
});

const executeToolCall = async (args: {
  call: { name: string; input: unknown };
  registry: Record<string, ToolSpec<any>>;
  ctx: ToolRunContext;
  state: AgentState;
  humanReview?: (args: { reason: string; patchPaths: string[]; phase: AgentState["phase"] }) => Promise<boolean>;
}): Promise<{ ok: boolean; note?: string; touchedPaths: string[]; resultData?: unknown; toolName: string }> => {
  const { call, registry, ctx, state, humanReview } = args;
  const tool = registry[call.name] as ToolSpec | undefined;
  if (!tool) {
    const note = `unknown tool ${call.name}`;
    state.lastError = { kind: "Unknown", message: note };
    return { ok: false, note, touchedPaths: [], toolName: call.name };
  }

  const parsed = tool.inputSchema.safeParse(call.input);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    state.lastError = { kind: "Config", message: detail };
    return { ok: false, note: detail, touchedPaths: [], toolName: call.name };
  }

  const result = await tool.run(parsed.data, ctx);
  const touched = result.meta?.touchedPaths ?? [];

  const beforePatches = new Set(state.patchPaths);
  state.touchedFiles = Array.from(new Set([...state.touchedFiles, ...touched]));
  state.patchPaths = Array.from(new Set([...state.patchPaths, ...ctx.memory.patchPaths]));
  const newPatchPaths = state.patchPaths.filter((path) => !beforePatches.has(path));

  if (newPatchPaths.length > 0 && humanReview) {
    const approved = await humanReview({
      reason: "Generated PATCH files require manual merge",
      patchPaths: newPatchPaths,
      phase: state.phase
    });
    state.humanReviews.push({ reason: "Generated PATCH files require manual merge", approved, patchPaths: newPatchPaths });
    if (!approved) {
      state.lastError = { kind: "Config", message: "Human review rejected automatic continuation after PATCH generation" };
      return { ok: false, note: state.lastError.message, touchedPaths: touched, resultData: result.data, toolName: call.name };
    }
  }

  if (!result.ok) {
    state.lastError = {
      kind: "Unknown",
      message: `${result.error?.message ?? "tool failed"}${result.error?.detail ? ` (${truncate(result.error.detail)})` : ""}`
    };
  }

  return {
    ok: result.ok,
    note: result.ok ? "ok" : state.lastError?.message,
    touchedPaths: touched,
    resultData: result.data,
    toolName: call.name
  };
};

const buildCriterionToolCall = (task: PlanTask, criterion: PlanTask["success_criteria"][number]): { name: string; input: unknown } | null => {
  if (criterion.type === "tool_result") return null;
  if (criterion.type === "file_exists") {
    return { name: "tool_check_file_exists", input: { base: "appDir", path: criterion.path } };
  }
  if (criterion.type === "file_contains") {
    return { name: "tool_check_file_contains", input: { base: "appDir", path: criterion.path, contains: criterion.contains } };
  }
  return {
    name: "tool_check_command",
    input: {
      cmd: criterion.cmd,
      args: criterion.args ?? [],
      cwd: criterion.cwd,
      expect_exit_code: criterion.expect_exit_code
    }
  };
};

const evaluateSuccessCriteriaWithTools = async (args: {
  task: PlanTask;
  registry: Record<string, ToolSpec<any>>;
  ctx: ToolRunContext;
  state: AgentState;
  toolResults: Array<{ name: string; ok: boolean }>;
  humanReview?: (args: { reason: string; patchPaths: string[]; phase: AgentState["phase"] }) => Promise<boolean>;
}): Promise<{ ok: boolean; failures: string[]; toolAudit: Array<{ name: string; ok: boolean; error?: string }> }> => {
  const failures: string[] = [];
  const toolAudit: Array<{ name: string; ok: boolean; error?: string }> = [];

  for (const criterion of args.task.success_criteria) {
    if (criterion.type === "tool_result") {
      const result = args.toolResults.find((r) => r.name === criterion.tool_name);
      if (!result || result.ok !== criterion.expected_ok) {
        failures.push(`tool_result failed for ${criterion.tool_name}`);
      }
      continue;
    }

    const checkCall = buildCriterionToolCall(args.task, criterion);
    if (!checkCall) continue;

    const executed = await executeToolCall({
      call: checkCall,
      registry: args.registry,
      ctx: args.ctx,
      state: args.state,
      humanReview: args.humanReview
    });

    toolAudit.push({ name: checkCall.name, ok: executed.ok, error: executed.ok ? undefined : executed.note });
    if (!executed.ok) {
      failures.push(`criteria check failed: ${checkCall.name}`);
    }
  }

  return { ok: failures.length === 0, failures, toolAudit };
};

const runAgentPlanMode = async (args: {
  state: AgentState;
  provider: LlmProvider;
  registry: Record<string, ToolSpec<any>>;
  toolDocs: ReturnType<typeof buildToolDocPack>;
  ctx: ToolRunContext;
  maxTurns: number;
  maxToolCallsPerTurn: number;
  audit: AgentTurnAuditCollector;
  policy: AgentPolicy;
  humanReview?: (args: { reason: string; patchPaths: string[]; phase: AgentState["phase"] }) => Promise<boolean>;
}) => {
  const { state, provider, registry, ctx, maxTurns, maxToolCallsPerTurn, audit, policy } = args;
  state.status = "planning";

  const planProposal = await proposePlan({
    goal: state.goal,
    provider,
    registry,
    stateSummary: summarizeState(state),
    policy,
    maxToolCallsPerTurn,
    instructions: PLAN_INSTRUCTIONS,
    previousResponseId: state.lastResponseId,
    truncation: state.flags.truncation,
    contextManagement:
      typeof state.flags.compactionThreshold === "number"
        ? [{ type: "compaction", compactThreshold: state.flags.compactionThreshold }]
        : undefined
  });

  state.lastResponseId = planProposal.responseId ?? state.lastResponseId;
  state.usedLLM = true;
  state.planData = planProposal.plan;
  state.planVersion = 1;
  state.completedTasks = [];
  state.planHistory = [{ type: "initial", version: 1, plan: planProposal.plan }];

  audit.recordTurn({
    turn: 0,
    llmRaw: planProposal.raw,
    llmPreviousResponseId: planProposal.previousResponseIdSent,
    llmResponseId: planProposal.responseId,
    llmUsage: planProposal.usage,
    toolCalls: [],
    toolResults: [],
    note: `initial plan generated: ${planProposal.plan.tasks.length} tasks`
  });

  const completed = new Set<string>();
  const taskFailures = new Map<string, string[]>();
  let replans = 0;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    state.budgets.usedTurns = turn;
    const currentPlan = requiredInput(state.planData, "plan missing in plan mode");
    const nextTask = getNextReadyTask(currentPlan, completed);

    if (!nextTask) {
      if (completed.size === currentPlan.tasks.length) {
        state.phase = "DONE";
        state.status = "done";
        break;
      }
      state.phase = "FAILED";
      state.status = "failed";
      state.lastError = { kind: "Config", message: "No executable task found (dependency cycle or invalid plan)" };
      break;
    }

    state.status = "executing";
    state.currentTaskId = nextTask.id;

    let taskDone = false;
    let attempts = 0;

    while (!taskDone && attempts < policy.budgets.max_retries_per_task) {
      attempts += 1;
      const actionPlan = await proposeTaskActionPlan({
        goal: state.goal,
        provider,
        policy,
        task: nextTask,
        planSummary: summarizePlan(currentPlan),
        stateSummary: {
          ...(summarizeState(state) as Record<string, unknown>),
          currentTask: nextTask
        },
        toolIndex: renderToolIndex(registry),
        recentFailures: taskFailures.get(nextTask.id) ?? [],
        previousResponseId: state.lastResponseId,
        instructions:
          "Plan mode task execution: return TaskActionPlanV1 JSON for this task only. Do not modify global plan here.",
        truncation: state.flags.truncation,
        contextManagement:
          typeof state.flags.compactionThreshold === "number"
            ? [{ type: "compaction", compactThreshold: state.flags.compactionThreshold }]
            : undefined
      });
      state.lastResponseId = actionPlan.responseId ?? state.lastResponseId;

      let toolCalls = actionPlan.actionPlan.actions.map((item) => ({ name: item.name, input: item.input }));
      toolCalls = toolCalls.slice(0, Math.min(maxToolCallsPerTurn, policy.budgets.max_actions_per_task));
      state.status = "executing";

      state.toolCalls = toolCalls;
      state.toolResults = [];

      const turnAuditResults: Array<{ name: string; ok: boolean; error?: string; touchedPaths?: string[] }> = [];
      const simpleToolResults: Array<{ name: string; ok: boolean }> = [];

      for (const call of toolCalls) {
        const executed = await executeToolCall({
          call,
          registry,
          ctx,
          state,
          humanReview: args.humanReview
        });
        state.toolResults.push(normalizeToolResults(executed.toolName, executed.ok, executed.note));
        turnAuditResults.push({
          name: executed.toolName,
          ok: executed.ok,
          error: executed.ok ? undefined : executed.note,
          touchedPaths: executed.touchedPaths
        });
        simpleToolResults.push({ name: executed.toolName, ok: executed.ok });
        const actionRule = actionPlan.actionPlan.actions.find((item) => item.name === call.name);
        if (!executed.ok && actionRule?.on_fail !== "continue") break;
      }

      state.status = "reviewing";
      const check = await evaluateSuccessCriteriaWithTools({
        task: nextTask,
        registry,
        ctx,
        state,
        toolResults: simpleToolResults,
        humanReview: args.humanReview
      });
      turnAuditResults.push(...check.toolAudit.map((item) => ({ name: item.name, ok: item.ok, error: item.error })));

      audit.recordTurn({
        turn,
        llmRaw: actionPlan.raw,
        llmPreviousResponseId: actionPlan.previousResponseIdSent,
        llmResponseId: actionPlan.responseId,
        llmUsage: actionPlan.usage,
        note: `task_action_plan for ${nextTask.id}`,
        toolCalls,
        toolResults: turnAuditResults
      });

      if (check.ok) {
        completed.add(nextTask.id);
        state.completedTasks = Array.from(completed);
        taskDone = true;
        continue;
      }

      taskFailures.set(nextTask.id, check.failures);

      if (attempts >= policy.budgets.max_retries_per_task) {
        state.status = "replanning";
        const changeProposal = await proposePlanChange({
          provider,
          goal: state.goal,
          currentPlan,
          policy,
          stateSummary: {
            ...(summarizeState(state) as Record<string, unknown>),
            failedTask: nextTask.id,
            failures: check.failures
          },
          failureEvidence: check.failures,
          previousResponseId: state.lastResponseId,
          instructions: PLAN_INSTRUCTIONS,
          truncation: state.flags.truncation,
          contextManagement:
            typeof state.flags.compactionThreshold === "number"
              ? [{ type: "compaction", compactThreshold: state.flags.compactionThreshold }]
              : undefined
        });

        state.lastResponseId = changeProposal.responseId ?? state.lastResponseId;
        state.planHistory?.push({ type: "change_request", request: changeProposal.changeRequest });

        const decision = evaluatePlanChange({
          request: changeProposal.changeRequest,
          policy,
          currentTaskCount: currentPlan.tasks.length
        });

        state.planHistory?.push({ type: "change_decision", decision });

        audit.recordTurn({
          turn,
          llmRaw: changeProposal.raw,
          llmPreviousResponseId: changeProposal.previousResponseIdSent,
          llmResponseId: changeProposal.responseId,
          llmUsage: changeProposal.usage,
          note: `plan-change ${decision.decision}: ${decision.reason}`,
          toolCalls: [],
          toolResults: []
        });

        if (decision.decision !== "approved") {
          state.phase = "FAILED";
          state.status = "failed";
          state.lastError = {
            kind: "Config",
            message: `Plan change ${decision.decision}: ${decision.reason}${
              decision.required_evidence.length > 0 ? ` (required: ${decision.required_evidence.join(", ")})` : ""
            }`
          };
          break;
        }

        if (replans >= policy.budgets.max_replans) {
          state.phase = "FAILED";
          state.status = "failed";
          state.lastError = { kind: "Config", message: `Replan budget exceeded: ${replans} >= ${policy.budgets.max_replans}` };
          break;
        }

        state.planData = applyPlanChangePatch(currentPlan, changeProposal.changeRequest);
        state.planVersion = (state.planVersion ?? 1) + 1;
        replans += 1;
      }
    }

    if (state.phase === "FAILED") break;
  }

  if (state.phase !== "FAILED" && state.phase !== "DONE") {
    state.phase = "FAILED";
    state.status = "failed";
    state.lastError = state.lastError ?? { kind: "Unknown", message: "max turns reached" };
  }
};

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
  humanReview?: (args: { reason: string; patchPaths: string[]; phase: AgentState["phase"] }) => Promise<boolean>;
}): Promise<{ ok: boolean; summary: string; auditPath?: string; patchPaths?: string[]; state: AgentState }> => {
  const provider = args.provider ?? getProviderFromEnv();
  const runCmdImpl = args.runCmdImpl ?? runCmd;
  const maxTurns = args.maxTurns ?? 16;
  const maxToolCallsPerTurn = args.maxToolCallsPerTurn ?? 4;
  const maxPatches = args.maxPatches ?? 8;
  const truncation = args.truncation ?? "auto";
  const compactionThreshold = args.compactionThreshold;

  const discovered = args.registry ? null : await loadToolRegistryWithDocs(args.registryDeps);
  const registry = args.registry ?? discovered?.registry ?? (await createToolRegistry(args.registryDeps));
  const toolDocs = discovered?.docs ?? buildToolDocPack(registry);
  const policy =
    args.policy ??
    defaultAgentPolicy({
      maxSteps: maxTurns,
      maxActionsPerTask: maxToolCallsPerTurn,
      maxRetriesPerTask: 3,
      maxReplans: 3,
      allowedTools: Object.keys(registry)
    });

  const state: AgentState = {
    phase: "BOOT",
    goal: args.goal,
    specPath: args.specPath,
    outDir: args.outDir,
    flags: {
      apply: args.apply,
      verify: args.verify,
      repair: args.repair,
      truncation,
      compactionThreshold
    },
    status: "planning",
    usedLLM: false,
    verifyHistory: [],
    budgets: {
      maxTurns,
      maxPatches,
      usedTurns: 0,
      usedPatches: 0,
      usedRepairs: 0
    },
    patchPaths: [],
    humanReviews: [],
    lastDeterministicFixes: [],
    repairKnownChecked: false,
    touchedFiles: [],
    toolCalls: [],
    toolResults: [],
    planHistory: []
  };

  const ctx: ToolRunContext = {
    provider,
    runCmdImpl,
    flags: {
      apply: state.flags.apply,
      verify: state.flags.verify,
      repair: state.flags.repair,
      maxPatchesPerTurn: maxPatches
    },
    memory: {
      specPath: state.specPath,
      outDir: state.outDir,
      patchPaths: [],
      touchedPaths: []
    }
  };

  const audit = new AgentTurnAuditCollector(args.goal);

  await runAgentPlanMode({
    state,
    provider,
    registry,
    toolDocs,
    ctx,
    maxTurns,
    maxToolCallsPerTurn,
    audit,
    policy,
    humanReview: args.humanReview
  });

  const base = state.appDir ?? state.outDir;
  const auditPath = await audit.flush(base, {
    ok: state.phase === "DONE",
    phase: state.phase,
    verifyHistory: state.verifyHistory,
    patchPaths: state.patchPaths,
    touchedFiles: state.touchedFiles.slice(-200),
    budgets: state.budgets,
    lastError: state.lastError,
    status: state.status,
    policy,
    toolIndex: renderToolIndex(registry)
  });

  if (state.phase === "DONE") {
    return {
      ok: true,
      summary: "Agent completed successfully",
      auditPath,
      patchPaths: state.patchPaths,
      state
    };
  }

  const message = state.lastError?.message ?? "max turns reached";
  return {
    ok: false,
    summary: message,
    auditPath,
    patchPaths: state.patchPaths,
    state
  };
};
