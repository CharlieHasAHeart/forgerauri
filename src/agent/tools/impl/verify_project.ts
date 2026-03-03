import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { CmdResult } from "../../../runner/runCmd.js";
import { assertCommandAllowed, assertCwdInside } from "../../../runtime/policy.js";
import type { AgentCmdRunner, ErrorKind, VerifyProjectResult, VerifyStepResult } from "../../types.js";
import type { AcceptanceStepEvent } from "../../core/evidence/types.js";
import {
  DEFAULT_ACCEPTANCE_PIPELINE_ID,
  getAcceptanceCommand,
  getAcceptancePipeline,
  type AcceptanceCommand
} from "../../core/acceptance/catalog.js";
import type { RuntimePaths } from "../../core/runtime_paths/types.js";
import { resolveCwdFromPolicy } from "../../core/acceptance/cwd_policy.js";

export const verifyProjectInputSchema = z.object({
  projectRoot: z.string().min(1)
});

const truncate = (value: string, max = 60000): string => (value.length > max ? `${value.slice(0, max)}...<truncated>` : value);

const isDepsBuildFailure = (stderr: string): boolean => {
  const text = stderr.toLowerCase();
  return (
    text.includes("cannot find module") ||
    text.includes("err_pnpm") ||
    text.includes("module_not_found") ||
    text.includes("node_modules") ||
    text.includes("pnpm install") ||
    text.includes("eai_again") ||
    text.includes("registry.npmjs.org")
  );
};

const classifyError = (step: VerifyStepResult["name"], stderr: string): ErrorKind => {
  const text = stderr.toLowerCase();
  if (step === "install" || step === "install_retry" || isDepsBuildFailure(stderr)) return "Deps";
  if ((step === "build" || step === "build_retry") && (text.includes("ts") || text.includes("type") || text.includes("vite"))) return "TS";
  if (step === "cargo_check" || text.includes("cargo") || text.includes("rustc") || text.includes("rusqlite")) return "Rust";
  if (step === "tauri_check" || step === "tauri_build" || text.includes("tauri")) return "Tauri";
  if (text.includes("config") || text.includes("toml") || text.includes("json")) return "Config";
  return "Unknown";
};

const suggestionFor = (kind: ErrorKind): string => {
  if (kind === "Deps") return "Install dependencies again and check network/proxy/registry access.";
  if (kind === "TS") return "Fix TypeScript/Svelte compile errors first.";
  if (kind === "Rust") return "Fix Rust compile or Cargo dependency errors.";
  if (kind === "Tauri") return "Fix Tauri toolchain/config; ensure tauri cli and Rust targets are available.";
  if (kind === "Config") return "Validate config files (package.json/tauri.conf/Cargo.toml).";
  return "Inspect stderr and apply minimal patch for the first failing step.";
};

const toStep = (name: VerifyStepResult["name"], result: CmdResult, skipped = false): VerifyStepResult => ({
  name,
  ok: result.ok,
  code: result.code,
  stdout: truncate(result.stdout),
  stderr: truncate(result.stderr),
  skipped
});

const okSkipped = (): CmdResult => ({ ok: true, code: 0, stdout: "skipped", stderr: "" });

const remainingSteps = (done: VerifyStepResult["name"][]): VerifyStepResult[] => {
  const ordered: VerifyStepResult["name"][] = ["install", "install_retry", "build", "build_retry", "cargo_check", "tauri_check", "tauri_build"];
  return ordered.filter((step) => !done.includes(step)).map((step) => toStep(step, okSkipped(), true));
};

const stepNamesForCommand = (commandId: string, attempt: number): VerifyStepResult["name"] => {
  if (commandId === "pnpm_install") return attempt > 1 ? "install_retry" : "install";
  if (commandId === "pnpm_build") return attempt > 1 ? "build_retry" : "build";
  if (commandId === "cargo_check") return "cargo_check";
  if (commandId === "pnpm_tauri_help") return "tauri_check";
  if (commandId === "pnpm_tauri_build") return "tauri_build";
  throw new Error(`unsupported pipeline command_id '${commandId}'`);
};

const shouldRetry = (retryOn: "nonzero_exit" | "deps_signal" | "always" | undefined, stderr: string): boolean => {
  if (retryOn === "always") return true;
  if (retryOn === "deps_signal") return isDepsBuildFailure(stderr);
  return true;
};

export const runVerifyProject = async (args: {
  projectRoot: string;
  runCmdImpl: AgentCmdRunner;
  pipelineId?: string;
  runtimePaths?: RuntimePaths;
  onCommandRun?: (event: {
    commandId: string;
    cmd: string;
    args: string[];
    cwd: string;
    ok: boolean;
    code: number;
    stdout: string;
    stderr: string;
  }) => void;
  evidence?: {
    onStepEvent?: (event: AcceptanceStepEvent) => void;
    knownSuccessfulCommandIds?: string[] | Set<string>;
    context?: {
      runId: string;
      turn: number;
      taskId: string;
    };
  };
}): Promise<VerifyProjectResult> => {
  // Standard desktop acceptance pipeline source of truth: desktop_tauri_default.
  const pipelineId = args.pipelineId ?? DEFAULT_ACCEPTANCE_PIPELINE_ID;
  const pipeline = getAcceptancePipeline(pipelineId);
  if (!pipeline) {
    throw new Error(`acceptance catalog is missing required '${pipelineId}' pipeline`);
  }

  const commandMap = new Map<string, AcceptanceCommand>();
  for (const step of pipeline.steps) {
    const command = getAcceptanceCommand(step.command_id);
    if (!command) {
      throw new Error(`acceptance catalog is missing required command '${step.command_id}'`);
    }
    commandMap.set(step.command_id, command);
  }

  const runtimePaths: RuntimePaths = args.runtimePaths ?? {
    repoRoot: args.projectRoot,
    appDir: args.projectRoot,
    tauriDir: join(args.projectRoot, "src-tauri").replace(/\\/g, "/")
  };

  const safeRun = async (cmd: string, argv: string[], cwd: string): Promise<CmdResult> => {
    assertCommandAllowed(cmd);
    assertCwdInside(args.projectRoot, cwd);
    return args.runCmdImpl(cmd, argv, cwd);
  };

  const steps: VerifyStepResult[] = [];
  const done: VerifyStepResult["name"][] = [];

  const push = (step: VerifyStepResult): void => {
    steps.push(step);
    done.push(step.name);
  };

  const fail = (stepName: VerifyStepResult["name"], stderr: string, summary: string): VerifyProjectResult => {
    const kind = classifyError(stepName, stderr);
    const filled = [...steps, ...remainingSteps(done)];
    return {
      ok: false,
      step: stepName,
      results: filled,
      summary,
      classifiedError: kind,
      suggestion: suggestionFor(kind)
    };
  };

  const prechecks = pipeline.execution?.prechecks ?? [];
  const retryRules = pipeline.execution?.retries ?? {};
  const knownSuccessfulCommandIdsSet = new Set(args.evidence?.knownSuccessfulCommandIds ?? []);
  const eventContext = args.evidence?.context;
  const emitStepEvent = (event: AcceptanceStepEvent): void => {
    args.evidence?.onStepEvent?.(event);
  };

  for (const step of pipeline.steps) {
    const stepId = `${pipeline.id}:${step.command_id}`;
    const command = commandMap.get(step.command_id)!;
    const retryRule = retryRules[step.command_id];
    const maxAttempts = Math.max(1, retryRule?.maxAttempts ?? 1);
    const cwd = resolveCwdFromPolicy(command.cwd_policy, runtimePaths);
    emitStepEvent({
      event_type: "acceptance_step_started",
      run_id: eventContext?.runId ?? "unknown",
      turn: eventContext?.turn ?? 0,
      task_id: eventContext?.taskId ?? "unknown",
      step_id: stepId,
      pipeline_id: pipeline.id,
      command_id: step.command_id,
      at: new Date().toISOString()
    });

    let skipped = false;
    let skipReason: "precheck_skip_if_exists" | "precheck_skip_if_cmd_ran_ok" | undefined;
    for (const precheck of prechecks) {
      if (precheck.command_id !== step.command_id) continue;
      if (precheck.kind === "skip_if_exists") {
        const precheckPath = precheck.path.startsWith("/") ? precheck.path : join(runtimePaths.appDir, precheck.path);
        if (existsSync(precheckPath)) {
          skipped = true;
          skipReason = "precheck_skip_if_exists";
        }
      }
      if (precheck.kind === "skip_if_cmd_ran_ok" && knownSuccessfulCommandIdsSet.has(step.command_id)) {
        skipped = true;
        skipReason = "precheck_skip_if_cmd_ran_ok";
      }
    }

    if (skipped) {
      emitStepEvent({
        event_type: "acceptance_step_skipped",
        run_id: eventContext?.runId ?? "unknown",
        turn: eventContext?.turn ?? 0,
        task_id: eventContext?.taskId ?? "unknown",
        step_id: stepId,
        pipeline_id: pipeline.id,
        command_id: step.command_id,
        reason: skipReason ?? "precheck_skip_if_exists",
        at: new Date().toISOString()
      });
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        push(toStep(stepNamesForCommand(step.command_id, attempt), okSkipped(), true));
      }
      continue;
    }

    let success = false;
    let lastFailedStep: VerifyStepResult | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const run = await safeRun(command.cmd, command.args, cwd);
      args.onCommandRun?.({
        commandId: step.command_id,
        cmd: command.cmd,
        args: command.args,
        cwd,
        ok: run.ok,
        code: run.code,
        stdout: run.stdout,
        stderr: run.stderr
      });
      emitStepEvent({
        event_type: "acceptance_step_finished",
        run_id: eventContext?.runId ?? "unknown",
        turn: eventContext?.turn ?? 0,
        task_id: eventContext?.taskId ?? "unknown",
        step_id: stepId,
        pipeline_id: pipeline.id,
        command_id: step.command_id,
        ok: run.ok,
        exit_code: run.code,
        at: new Date().toISOString()
      });

      const verifyStep = toStep(stepNamesForCommand(step.command_id, attempt), run);
      push(verifyStep);

      if (run.ok) {
        success = true;
        for (let pad = attempt + 1; pad <= maxAttempts; pad += 1) {
          push(toStep(stepNamesForCommand(step.command_id, pad), okSkipped(), true));
        }
        break;
      }

      lastFailedStep = verifyStep;
      if (attempt < maxAttempts && shouldRetry(retryRule?.retryOn, run.stderr)) {
        continue;
      }
      break;
    }

    if (!success) {
      if (step.optional) {
        continue;
      }
      const failedStepName = lastFailedStep?.name ?? stepNamesForCommand(step.command_id, 1);
      const failedStderr = lastFailedStep?.stderr ?? "verify failed";
      return fail(failedStepName, failedStderr, `verify failed at ${failedStepName}`);
    }
  }

  const filled = [...steps, ...remainingSteps(done)];
  return {
    ok: true,
    step: "none",
    results: filled,
    summary: "verify passed",
    classifiedError: "Unknown",
    suggestion: "No action needed."
  };
};
