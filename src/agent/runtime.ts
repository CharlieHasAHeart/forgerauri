import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AgentTurnAuditCollector } from "../runtime/audit/index.js";
import { proposeNextActions, proposePlan, proposePlanChange, renderToolIndex } from "./brain.js";
import { applyPlanChange, getNextReadyTask, summarizePlan } from "./plan/helpers.js";
import { evaluatePlanChange } from "./plan/gate.js";
import type { PlanTask } from "./plan/schema.js";
import { createToolRegistry, loadToolRegistryWithDocs } from "./tools/registry.js";
import { buildToolDocPack } from "./tools/loader.js";
import type { ToolRunContext, ToolSpec } from "./tools/types.js";
import { getProviderFromEnv } from "../llm/index.js";
import type { LlmProvider } from "../llm/provider.js";
import { runCmd, type CmdResult } from "../runner/runCmd.js";
import type { AgentState, ErrorKind, VerifyProjectResult } from "./types.js";

const truncate = (value: string, max = 4000): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

const PHASE_INSTRUCTIONS =
  "You are the Brain of a coding agent. You must call tools and never fabricate results. " +
  "Hard guardrails: user-zone files cannot be overwritten directly, only patch artifacts are allowed. " +
  "Use tool documentation to choose calls. Return JSON only: {\"toolCalls\":[{\"name\":\"...\",\"input\":{}}],\"note\":\"optional\"}.";

const PLAN_INSTRUCTIONS =
  "You are the planning brain for a coding agent. Always follow plan-first execution and produce strict JSON only.";

const classifyFromVerify = (result: VerifyProjectResult): ErrorKind => result.classifiedError;

const summarizeState = (state: AgentState): unknown => ({
  phase: state.phase,
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

const evaluateSuccessCriteria = async (args: {
  task: PlanTask;
  appDir?: string;
  runCmdImpl: (cmd: string, args: string[], cwd: string) => Promise<CmdResult>;
  toolResults: Array<{ name: string; ok: boolean }>;
  outDir: string;
}): Promise<{ ok: boolean; failures: string[] }> => {
  const failures: string[] = [];

  for (const criterion of args.task.success_criteria) {
    if (criterion.type === "tool_result") {
      const result = args.toolResults.find((r) => r.name === criterion.tool_name);
      if (!result || result.ok !== criterion.expected_ok) {
        failures.push(`tool_result failed for ${criterion.tool_name}`);
      }
      continue;
    }

    if (criterion.type === "command") {
      const cwd = criterion.cwd ? resolve(args.appDir ?? args.outDir, criterion.cwd) : args.appDir ?? args.outDir;
      const out = await args.runCmdImpl(criterion.cmd, criterion.args ?? [], cwd);
      if (out.code !== criterion.expect_exit_code) {
        failures.push(`command failed: ${criterion.cmd} ${(criterion.args ?? []).join(" ")} -> ${out.code}`);
      }
      continue;
    }

    const base = args.appDir ?? args.outDir;
    const abs = resolve(base, criterion.path);
    if (criterion.type === "file_exists") {
      if (!existsSync(abs)) failures.push(`file missing: ${criterion.path}`);
      continue;
    }

    if (criterion.type === "file_contains") {
      if (!existsSync(abs)) {
        failures.push(`file missing for contains check: ${criterion.path}`);
        continue;
      }
      const content = await readFile(abs, "utf8");
      if (!content.includes(criterion.contains)) {
        failures.push(`file does not contain expected text: ${criterion.path}`);
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures
  };
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
  humanReview?: (args: { reason: string; patchPaths: string[]; phase: AgentState["phase"] }) => Promise<boolean>;
}) => {
  const { state, provider, registry, ctx, maxTurns, maxToolCallsPerTurn, audit } = args;

  const planProposal = await proposePlan({
    goal: state.goal,
    provider,
    registry,
    stateSummary: summarizeState(state),
    constraints: {
      maxSteps: maxTurns,
      maxToolCallsPerTurn,
      acceptanceLocked: true,
      techStackLocked: true
    },
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

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    state.budgets.usedTurns = turn;
    const currentPlan = requiredInput(state.planData, "plan missing in plan mode");
    const nextTask = getNextReadyTask(currentPlan, completed);

    if (!nextTask) {
      if (completed.size === currentPlan.tasks.length) {
        state.phase = "DONE";
        break;
      }
      state.phase = "FAILED";
      state.lastError = { kind: "Config", message: "No executable task found (dependency cycle or invalid plan)" };
      break;
    }

    state.currentTaskId = nextTask.id;

    let taskDone = false;
    let attempts = 0;

    while (!taskDone && attempts < 3) {
      attempts += 1;
      const taskGoal = `${state.goal}\n\nExecute task ${nextTask.id}: ${nextTask.title}\n${nextTask.description}\n`;
      const proposed = await proposeNextActions({
        goal: taskGoal,
        provider,
        registry,
        toolDocs: args.toolDocs,
        stateSummary: {
          ...(summarizeState(state) as Record<string, unknown>),
          currentTask: nextTask,
          previousFailures: taskFailures.get(nextTask.id) ?? []
        },
        maxToolCallsPerTurn,
        instructions:
          "You are executing one task from a locked plan. Return only tool calls needed for this task. Do not modify the plan in this step.",
        previousResponseId: state.lastResponseId,
        truncation: state.flags.truncation,
        contextManagement:
          typeof state.flags.compactionThreshold === "number"
            ? [{ type: "compaction", compactThreshold: state.flags.compactionThreshold }]
            : undefined
      });
      state.lastResponseId = proposed.responseId ?? state.lastResponseId;

      let toolCalls = proposed.toolCalls.slice(0, maxToolCallsPerTurn);
      if (toolCalls.length === 0 && nextTask.tool_hints.length > 0) {
        toolCalls = nextTask.tool_hints
          .filter((name) => !!registry[name])
          .slice(0, maxToolCallsPerTurn)
          .map((name) => ({ name, input: {} }));
      }

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
        if (!executed.ok) break;
      }

      const check = await evaluateSuccessCriteria({
        task: nextTask,
        appDir: state.appDir,
        runCmdImpl: ctx.runCmdImpl,
        toolResults: simpleToolResults,
        outDir: state.outDir
      });

      audit.recordTurn({
        turn,
        llmRaw: proposed.raw,
        llmPreviousResponseId: proposed.previousResponseIdSent,
        llmResponseId: proposed.responseId,
        llmUsage: proposed.usage,
        note: proposed.reasoning,
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

      if (attempts >= 3) {
        const changeProposal = await proposePlanChange({
          provider,
          goal: state.goal,
          currentPlan,
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
          maxSteps: state.budgets.maxTurns,
          currentTaskCount: currentPlan.tasks.length,
          allowedToolNames: Object.keys(registry),
          allowedCommandPrefixes: ["pnpm", "cargo", "node", "tauri"],
          userExplicitlyAllowedRelaxAcceptance: false
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
          state.lastError = {
            kind: "Config",
            message: `Plan change ${decision.decision}: ${decision.reason}${
              decision.required_evidence.length > 0 ? ` (required: ${decision.required_evidence.join(", ")})` : ""
            }`
          };
          break;
        }

        state.planData = applyPlanChange(currentPlan, changeProposal.changeRequest);
        state.planVersion = (state.planVersion ?? 1) + 1;
      }
    }

    if (state.phase === "FAILED") break;
  }

  if (state.phase !== "FAILED" && state.phase !== "DONE") {
    state.phase = "FAILED";
    state.lastError = state.lastError ?? { kind: "Unknown", message: "max turns reached" };
  }
};

const runAgentPhaseMode = async (args: {
  state: AgentState;
  provider: LlmProvider;
  registry: Record<string, ToolSpec<any>>;
  toolDocs: ReturnType<typeof buildToolDocPack>;
  ctx: ToolRunContext;
  maxTurns: number;
  maxToolCallsPerTurn: number;
  audit: AgentTurnAuditCollector;
  humanReview?: (args: { reason: string; patchPaths: string[]; phase: AgentState["phase"] }) => Promise<boolean>;
}) => {
  const { state, provider, registry, toolDocs, ctx, maxTurns, maxToolCallsPerTurn, audit } = args;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    state.budgets.usedTurns = turn;

    const proposed = await proposeNextActions({
      goal: state.goal,
      provider,
      registry,
      toolDocs,
      stateSummary: summarizeState(state),
      maxToolCallsPerTurn,
      instructions: PHASE_INSTRUCTIONS,
      previousResponseId: state.lastResponseId,
      truncation: state.flags.truncation,
      contextManagement:
        typeof state.flags.compactionThreshold === "number"
          ? [{ type: "compaction", compactThreshold: state.flags.compactionThreshold }]
          : undefined
    });
    state.lastResponseId = proposed.responseId ?? state.lastResponseId;

    let toolCalls = [...proposed.toolCalls];

    try {
      if (state.phase === "BOOT") {
        toolCalls = [
          {
            name: "tool_bootstrap_project",
            input: {
              specPath: state.specPath,
              outDir: state.outDir,
              apply: state.flags.apply
            }
          }
        ];
      } else if (state.phase === "DESIGN_CONTRACT") {
        toolCalls = [{ name: "tool_design_contract", input: { goal: state.goal, specPath: state.specPath, projectRoot: state.appDir } }];
      } else if (state.phase === "MATERIALIZE_CONTRACT") {
        toolCalls = [
          {
            name: "tool_materialize_contract",
            input: {
              contract: requiredInput(state.contract, "materialize contract phase missing contract"),
              outDir: state.outDir,
              appDir: requiredInput(state.appDir, "materialize contract phase missing appDir"),
              apply: state.flags.apply
            }
          }
        ];
      } else if (state.phase === "DESIGN_UX") {
        toolCalls = [
          {
            name: "tool_design_ux",
            input: {
              goal: state.goal,
              specPath: state.specPath,
              contract: requiredInput(state.contract, "design ux phase missing contract"),
              projectRoot: state.appDir
            }
          }
        ];
      } else if (state.phase === "MATERIALIZE_UX") {
        toolCalls = [
          {
            name: "tool_materialize_ux",
            input: {
              ux: requiredInput(state.ux, "materialize ux phase missing ux"),
              projectRoot: requiredInput(state.appDir, "materialize ux phase missing appDir"),
              apply: state.flags.apply
            }
          }
        ];
      } else if (state.phase === "DESIGN_IMPL") {
        toolCalls = [
          {
            name: "tool_design_implementation",
            input: {
              goal: state.goal,
              contract: requiredInput(state.contract, "design implementation phase missing contract"),
              ux: state.ux,
              projectRoot: state.appDir
            }
          }
        ];
      } else if (state.phase === "MATERIALIZE_IMPL") {
        toolCalls = [
          {
            name: "tool_materialize_implementation",
            input: {
              impl: requiredInput(state.impl, "materialize implementation phase missing impl"),
              projectRoot: requiredInput(state.appDir, "materialize implementation phase missing appDir"),
              apply: state.flags.apply
            }
          }
        ];
      } else if (state.phase === "DESIGN_DELIVERY") {
        toolCalls = [
          {
            name: "tool_design_delivery",
            input: {
              goal: state.goal,
              contract: requiredInput(state.contract, "design delivery phase missing contract"),
              projectRoot: state.appDir
            }
          }
        ];
      } else if (state.phase === "MATERIALIZE_DELIVERY") {
        toolCalls = [
          {
            name: "tool_materialize_delivery",
            input: {
              delivery: requiredInput(state.delivery, "materialize delivery phase missing delivery"),
              projectRoot: requiredInput(state.appDir, "materialize delivery phase missing appDir"),
              apply: state.flags.apply
            }
          }
        ];
      } else if (state.phase === "VALIDATE_DESIGN") {
        toolCalls = [{ name: "tool_validate_design", input: { projectRoot: requiredInput(state.appDir, "validate design phase missing appDir") } }];
      } else if (state.phase === "CODEGEN_FROM_DESIGN") {
        toolCalls = [
          {
            name: "tool_codegen_from_design",
            input: { projectRoot: requiredInput(state.appDir, "codegen phase missing appDir"), apply: state.flags.apply }
          }
        ];
      } else if (state.phase === "VERIFY" && state.appDir) {
        toolCalls = [createVerifyCall(state.appDir)];
      } else if (state.phase === "REPAIR") {
        if (!state.repairKnownChecked && state.appDir) {
          toolCalls = [{ name: "tool_repair_known_issues", input: { projectRoot: state.appDir } }];
        } else {
          const repairCmd = inferRepairCommand(state);
          if (repairCmd) {
            toolCalls = [createRepairOnceCall(requiredInput(state.appDir, "repair phase missing appDir"), repairCmd)];
          } else {
            state.phase = "FAILED";
            state.lastError = { kind: "Config", message: "Unable to infer repair command from verify history" };
            toolCalls = [];
          }
        }
      }
    } catch (error) {
      state.phase = "FAILED";
      state.lastError = { kind: "Config", message: error instanceof Error ? error.message : "phase input missing" };
      toolCalls = [];
    }

    state.toolCalls = toolCalls;
    state.toolResults = [];

    const turnAuditResults: Array<{ name: string; ok: boolean; error?: string; touchedPaths?: string[] }> = [];

    for (const call of toolCalls) {
      const executed = await executeToolCall({ call, registry, ctx, state, humanReview: args.humanReview });
      state.toolResults.push(normalizeToolResults(executed.toolName, executed.ok, executed.note));
      turnAuditResults.push({
        name: executed.toolName,
        ok: executed.ok,
        error: executed.ok ? undefined : executed.note,
        touchedPaths: executed.touchedPaths
      });

      if (state.phase === "FAILED") continue;

      if (call.name === "tool_bootstrap_project" && executed.ok) {
        const data = executed.resultData as { appDir: string; usedLLM: boolean };
        state.appDir = data.appDir;
        state.projectRoot = data.appDir;
        state.usedLLM = data.usedLLM;
        state.phase = "DESIGN_CONTRACT";
      }

      if (call.name === "tool_design_contract" && executed.ok) {
        state.contract = (executed.resultData as { contract: AgentState["contract"] }).contract;
        state.phase = "MATERIALIZE_CONTRACT";
      }

      if (call.name === "tool_materialize_contract" && executed.ok) {
        const data = executed.resultData as { appDir: string; contractPath: string };
        state.appDir = data.appDir;
        state.projectRoot = data.appDir;
        state.contractPath = data.contractPath;
        state.phase = "DESIGN_UX";
      }

      if (call.name === "tool_design_ux" && executed.ok) {
        state.ux = (executed.resultData as { ux: AgentState["ux"] }).ux;
        state.phase = "MATERIALIZE_UX";
      }

      if (call.name === "tool_materialize_ux" && executed.ok) {
        state.uxPath = (executed.resultData as { uxPath: string }).uxPath;
        state.phase = "DESIGN_IMPL";
      }

      if (call.name === "tool_design_implementation" && executed.ok) {
        state.impl = (executed.resultData as { impl: AgentState["impl"] }).impl;
        state.phase = "MATERIALIZE_IMPL";
      }

      if (call.name === "tool_materialize_implementation" && executed.ok) {
        state.implPath = (executed.resultData as { implPath: string }).implPath;
        state.phase = "DESIGN_DELIVERY";
      }

      if (call.name === "tool_design_delivery" && executed.ok) {
        state.delivery = (executed.resultData as { delivery: AgentState["delivery"] }).delivery;
        state.phase = "MATERIALIZE_DELIVERY";
      }

      if (call.name === "tool_materialize_delivery" && executed.ok) {
        state.deliveryPath = (executed.resultData as { deliveryPath: string }).deliveryPath;
        state.phase = "VALIDATE_DESIGN";
      }

      if (call.name === "tool_validate_design" && executed.ok) {
        const data = executed.resultData as { ok: boolean; errors: Array<{ code: string; message: string; path?: string }>; summary: string };
        state.designValidation = { ok: data.ok, errorsCount: data.errors.length, summary: data.summary };
        if (!data.ok) {
          const preview = data.errors
            .slice(0, 3)
            .map((error) => `${error.code}${error.path ? `@${error.path}` : ""}: ${error.message}`)
            .join(" | ");
          state.lastError = { kind: "Config", message: `${data.summary}${preview ? ` | ${preview}` : ""}` };
          state.phase = "FAILED";
        } else {
          state.phase = "CODEGEN_FROM_DESIGN";
        }
      }

      if (call.name === "tool_codegen_from_design" && executed.ok) {
        const data = executed.resultData as { generated: string[]; summary: { wrote: number; skipped: number } };
        state.codegenSummary = { generatedFilesCount: data.generated.length, wrote: data.summary.wrote, skipped: data.summary.skipped };
        state.phase = state.flags.verify ? "VERIFY" : "DONE";
      }

      if (call.name === "tool_verify_project") {
        const verifyData = executed.resultData as VerifyProjectResult;
        state.verifyHistory.push(verifyData);

        if (verifyData.ok) {
          state.phase = "DONE";
          state.lastError = undefined;
        } else {
          state.lastError = {
            kind: classifyFromVerify(verifyData),
            message: verifyData.summary,
            command: inferRepairCommand(state) ?? undefined
          };
          state.repairKnownChecked = false;
          state.lastDeterministicFixes = [];
          state.phase = state.flags.repair ? "REPAIR" : "FAILED";
        }
      }

      if (call.name === "tool_repair_known_issues") {
        if (executed.ok) {
          const data = executed.resultData as { changed: boolean; fixes: Array<{ id: string }> };
          state.lastDeterministicFixes = data.fixes.map((fix) => fix.id);
          if (data.changed) {
            state.repairKnownChecked = false;
            if (state.appDir && !toolCalls.some((queued) => queued.name === "tool_verify_project")) {
              toolCalls.push(createVerifyCall(state.appDir));
            }
            state.phase = "REPAIR";
          } else {
            state.repairKnownChecked = true;
            const repairCmd = inferRepairCommand(state);
            if (!repairCmd || !state.appDir) {
              state.phase = "FAILED";
              state.lastError = { kind: "Config", message: "Unable to infer repair command from verify history" };
              continue;
            }
            toolCalls.push(createRepairOnceCall(state.appDir, repairCmd));
            state.phase = "REPAIR";
          }
        } else {
          state.repairKnownChecked = true;
          const repairCmd = inferRepairCommand(state);
          if (!repairCmd || !state.appDir) {
            state.lastError = { kind: state.lastError?.kind ?? "Unknown", message: "deterministic known-issues repair failed" };
            state.phase = "FAILED";
            continue;
          }
          toolCalls.push(createRepairOnceCall(state.appDir, repairCmd));
          state.phase = "REPAIR";
        }
      }

      if (call.name === "tool_repair_once") {
        state.budgets.usedRepairs += 1;
        state.budgets.usedPatches = state.budgets.usedRepairs;
        state.repairKnownChecked = false;
        if (!executed.ok) {
          state.lastError = {
            kind: state.lastError?.kind ?? "Unknown",
            message: state.lastError?.message ?? executed.note ?? "repair failed"
          };
          state.phase = "FAILED";
        } else {
          if (state.appDir && !toolCalls.some((queued) => queued.name === "tool_verify_project")) {
            toolCalls.push(createVerifyCall(state.appDir));
          }
          state.phase = "REPAIR";
        }
      }

      if (!executed.ok && call.name !== "tool_verify_project" && call.name !== "tool_repair_once" && call.name !== "tool_repair_known_issues") {
        state.lastError = { kind: "Unknown", message: executed.note ?? "tool failed" };
        state.phase = "FAILED";
      }

      if (state.budgets.usedRepairs > state.budgets.maxPatches) {
        state.phase = "FAILED";
        state.lastError = { kind: "Config", message: `Repair budget exceeded: ${state.budgets.usedRepairs} > ${state.budgets.maxPatches}` };
      }
    }

    audit.recordTurn({
      turn,
      llmRaw: proposed.raw,
      llmPreviousResponseId: proposed.previousResponseIdSent,
      llmResponseId: proposed.responseId,
      llmUsage: proposed.usage,
      note: proposed.reasoning,
      toolCalls,
      toolResults: turnAuditResults
    });

    if (state.phase === "DONE" || state.phase === "FAILED") break;
  }

  if (state.phase !== "DONE" && state.phase !== "FAILED") {
    state.phase = "FAILED";
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
  mode?: "phase" | "plan";
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
  const mode = args.mode ?? "plan";

  const discovered = args.registry ? null : await loadToolRegistryWithDocs(args.registryDeps);
  const registry = args.registry ?? discovered?.registry ?? (await createToolRegistry(args.registryDeps));
  const toolDocs = discovered?.docs ?? buildToolDocPack(registry);

  const state: AgentState = {
    phase: "BOOT",
    goal: args.goal,
    specPath: args.specPath,
    outDir: args.outDir,
    flags: {
      apply: args.apply,
      verify: args.verify,
      repair: args.repair,
      mode,
      truncation,
      compactionThreshold
    },
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

  if (mode === "phase") {
    await runAgentPhaseMode({
      state,
      provider,
      registry,
      toolDocs,
      ctx,
      maxTurns,
      maxToolCallsPerTurn,
      audit,
      humanReview: args.humanReview
    });
  } else {
    await runAgentPlanMode({
      state,
      provider,
      registry,
      toolDocs,
      ctx,
      maxTurns,
      maxToolCallsPerTurn,
      audit,
      humanReview: args.humanReview
    });
  }

  const base = state.appDir ?? state.outDir;
  const auditPath = await audit.flush(base, {
    ok: state.phase === "DONE",
    phase: state.phase,
    verifyHistory: state.verifyHistory,
    patchPaths: state.patchPaths,
    touchedFiles: state.touchedFiles.slice(-200),
    budgets: state.budgets,
    lastError: state.lastError,
    mode: state.flags.mode,
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
