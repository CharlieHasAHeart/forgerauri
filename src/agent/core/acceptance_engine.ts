import type { EvidenceEvent } from "./evidence.js";
import type {
  BootstrapIntent,
  EnsurePathsIntent,
  Intent,
  VerifyAcceptancePipelineIntent,
  VerifyCommandIntent,
  VerifyToolExitIntent
} from "./intent.js";
import { normalizePath } from "./path_normalizer.js";
import {
  type AcceptanceStepRequirement,
  dedupeRequirements,
  requirementKey,
  type CommandExitRequirement,
  type FileExistsRequirement,
  type Requirement,
  type ToolExitCodeRequirement
} from "./requirement.js";
import type { WorkspaceSnapshot } from "./workspace_snapshot.js";
import { getAcceptanceCommand, getAcceptancePipeline } from "./acceptance_catalog.js";

export type EvaluationResult = {
  status: "pending" | "satisfied" | "failed";
  requirements: Requirement[];
  satisfied_requirements: Requirement[];
  diagnostics: string[];
  audit?: { replaced?: Array<{ from: Requirement; to: Requirement; reason: string }> };
};

type EvalInput = {
  goal: string;
  intent: Intent;
  evidence: EvidenceEvent[];
  snapshot: WorkspaceSnapshot;
  runtime?: {
    repoRoot?: string;
    appDir?: string;
    tauriDir?: string;
  };
};

const canonicalFileExistsRequirement = (
  path: string,
  replaced: Array<{ from: Requirement; to: Requirement; reason: string }>
): FileExistsRequirement => {
  const normalized = normalizePath(path);
  const to: FileExistsRequirement = { kind: "file_exists", path: normalized.canonical };
  if (normalized.canonical !== path) {
    replaced.push({
      from: { kind: "file_exists", path },
      to,
      reason: normalized.reason ?? "path normalized"
    });
  }
  return to;
};

const evaluateBootstrapIntent = (input: Omit<EvalInput, "intent"> & { intent: BootstrapIntent }): EvaluationResult => {
  const diagnostics: string[] = [];
  const replaced: Array<{ from: Requirement; to: Requirement; reason: string }> = [];
  const required = dedupeRequirements<FileExistsRequirement>(
    input.intent.fingerprints.map((path) => canonicalFileExistsRequirement(path, replaced))
  );

  const satisfied = required.filter((requirement) => input.snapshot.exists(requirement.path));
  const missing = required.filter((requirement) => !input.snapshot.exists(requirement.path));

  const bootstrapSucceeded = input.evidence.some(
    (event) => event.event_type === "tool_returned" && event.tool_name === "tool_bootstrap_project" && event.ok
  );
  if (bootstrapSucceeded && missing.length > 0) {
    diagnostics.push("bootstrap tool reported ok but some fingerprint files are missing in snapshot");
  }

  return {
    status: missing.length === 0 ? "satisfied" : "pending",
    requirements: missing,
    satisfied_requirements: satisfied,
    diagnostics,
    audit: replaced.length > 0 ? { replaced } : undefined
  };
};

const evaluateEnsurePathsIntent = (input: Omit<EvalInput, "intent"> & { intent: EnsurePathsIntent }): EvaluationResult => {
  const diagnostics: string[] = [];
  const replaced: Array<{ from: Requirement; to: Requirement; reason: string }> = [];
  const required = dedupeRequirements<FileExistsRequirement>(
    input.intent.expected_paths.map((path) => canonicalFileExistsRequirement(path, replaced))
  );

  const satisfied = required.filter((requirement) => input.snapshot.exists(requirement.path));
  const missing = required.filter((requirement) => !input.snapshot.exists(requirement.path));

  const recentTouchedPaths = input.evidence
    .filter((event): event is Extract<EvidenceEvent, { event_type: "tool_returned" }> => event.event_type === "tool_returned")
    .slice(-5)
    .flatMap((event) => event.touched_paths ?? []);
  if (recentTouchedPaths.length > 0) {
    diagnostics.push(`recent touched_paths hints: ${Array.from(new Set(recentTouchedPaths)).join(", ")}`);
  }

  return {
    status: missing.length === 0 ? "satisfied" : "pending",
    requirements: missing,
    satisfied_requirements: satisfied,
    diagnostics,
    audit: replaced.length > 0 ? { replaced } : undefined
  };
};

const evaluateVerifyToolExitIntent = (input: Omit<EvalInput, "intent"> & { intent: VerifyToolExitIntent }): EvaluationResult => {
  const requirement: ToolExitCodeRequirement = {
    kind: "tool_exit_code",
    tool_name: input.intent.tool_name,
    expect_exit_code: input.intent.expect_exit_code
  };

  const matched = input.evidence.some(
    (event) =>
      event.event_type === "tool_returned" &&
      event.tool_name === input.intent.tool_name &&
      event.ok === true &&
      event.exit_code === input.intent.expect_exit_code
  );

  if (matched) {
    return {
      status: "satisfied",
      requirements: [],
      satisfied_requirements: [requirement],
      diagnostics: []
    };
  }

  return {
    status: "pending",
    requirements: [requirement],
    satisfied_requirements: [],
    diagnostics: []
  };
};

const sameArgs = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, idx) => value === right[idx]);

const evaluateVerifyCommandIntent = (input: Omit<EvalInput, "intent"> & { intent: VerifyCommandIntent }): EvaluationResult => {
  const requirement: CommandExitRequirement = {
    kind: "command_exit",
    cmd: input.intent.cmd,
    args: input.intent.args,
    cwd: input.intent.cwd,
    expect_exit_code: input.intent.expect_exit_code
  };

  const matched = input.evidence.some((event) => {
    if (event.event_type !== "command_ran") return false;
    if (event.cmd !== input.intent.cmd) return false;
    if (!sameArgs(event.args, input.intent.args)) return false;
    if (input.intent.cwd !== undefined && event.cwd !== input.intent.cwd) return false;
    if (event.exit_code !== input.intent.expect_exit_code) return false;
    return event.ok === true;
  });

  if (matched) {
    return {
      status: "satisfied",
      requirements: [],
      satisfied_requirements: [requirement],
      diagnostics: []
    };
  }

  return {
    status: "pending",
    requirements: [requirement],
    satisfied_requirements: [],
    diagnostics: []
  };
};

const resolveCwd = (
  policy: { cwd_policy: "repo_root" | "app_dir" | "tauri_dir" | { explicit: string } },
  runtime: EvalInput["runtime"]
): string => {
  const repoRoot = runtime?.repoRoot ?? ".";
  const appDir = runtime?.appDir ?? "./generated/app";
  const tauriDir = runtime?.tauriDir ?? "./generated/app/src-tauri";
  if (typeof policy.cwd_policy === "object") return policy.cwd_policy.explicit;
  if (policy.cwd_policy === "repo_root") return repoRoot;
  if (policy.cwd_policy === "app_dir") return appDir;
  return tauriDir;
};

const evaluateVerifyAcceptancePipelineIntent = (
  input: Omit<EvalInput, "intent"> & { intent: VerifyAcceptancePipelineIntent }
): EvaluationResult => {
  const pipeline = getAcceptancePipeline(input.intent.pipeline_id);
  if (!pipeline) {
    return {
      status: "failed",
      requirements: [],
      satisfied_requirements: [],
      diagnostics: [`unknown acceptance pipeline: ${input.intent.pipeline_id}`]
    };
  }

  const strictOrder = input.intent.strict_order ?? pipeline.strict_order ?? false;
  const diagnostics: string[] = [];
  if (!input.runtime?.repoRoot || !input.runtime?.appDir || !input.runtime?.tauriDir) {
    diagnostics.push("runtime paths incomplete; used fallback repoRoot/appDir/tauriDir");
  }
  const requiredSteps: AcceptanceStepRequirement[] = [];

  for (const step of pipeline.steps) {
    const command = getAcceptanceCommand(step.command_id);
    if (!command) {
      return {
        status: "failed",
        requirements: [],
        satisfied_requirements: [],
        diagnostics: [`pipeline '${pipeline.id}' references unknown command '${step.command_id}'`]
      };
    }
    requiredSteps.push({
      kind: "acceptance_step",
      pipeline_id: pipeline.id,
      command_id: command.id,
      resolved_cmd: command.cmd,
      resolved_args: command.args,
      resolved_cwd: resolveCwd(command, input.runtime),
      expect_exit_code: command.expect_exit_code
    });
  }

  const commandEvents = input.evidence.filter(
    (event): event is Extract<EvidenceEvent, { event_type: "command_ran" }> => event.event_type === "command_ran"
  );
  const matchesStep = (step: AcceptanceStepRequirement, event: Extract<EvidenceEvent, { event_type: "command_ran" }>): boolean =>
    event.cmd === step.resolved_cmd &&
    sameArgs(event.args, step.resolved_args) &&
    event.cwd === step.resolved_cwd &&
    event.exit_code === step.expect_exit_code &&
    event.ok === true;

  const satisfied: AcceptanceStepRequirement[] = [];
  const missing: AcceptanceStepRequirement[] = [];

  if (strictOrder) {
    let cursor = 0;
    for (const step of requiredSteps) {
      let foundIndex = -1;
      for (let i = cursor; i < commandEvents.length; i += 1) {
        if (matchesStep(step, commandEvents[i]!)) {
          foundIndex = i;
          break;
        }
      }
      if (foundIndex >= 0) {
        satisfied.push(step);
        cursor = foundIndex + 1;
      } else {
        missing.push(step);
      }
    }
  } else {
    for (const step of requiredSteps) {
      if (commandEvents.some((event) => matchesStep(step, event))) satisfied.push(step);
      else missing.push(step);
    }
  }

  if (missing.length > 0) {
    diagnostics.push(
      `missing acceptance steps: ${missing.map((step) => `${step.command_id}(${step.resolved_cmd} ${step.resolved_args.join(" ")})`).join(", ")}`
    );
  }

  return {
    status: missing.length === 0 ? "satisfied" : "pending",
    requirements: missing,
    satisfied_requirements: satisfied,
    diagnostics
  };
};

export const evaluateAcceptance = (input: EvalInput): EvaluationResult => {
  void input.goal;
  let result: EvaluationResult;
  if (input.intent.type === "bootstrap") {
    result = evaluateBootstrapIntent({ ...input, intent: input.intent });
  } else if (input.intent.type === "ensure_paths") {
    result = evaluateEnsurePathsIntent({ ...input, intent: input.intent });
  } else if (input.intent.type === "verify_acceptance_pipeline") {
    result = evaluateVerifyAcceptancePipelineIntent({ ...input, intent: input.intent });
  } else if (input.intent.type === "verify_command") {
    result = evaluateVerifyCommandIntent({ ...input, intent: input.intent });
  } else {
    result = evaluateVerifyToolExitIntent({ ...input, intent: input.intent });
  }

  // Deterministic dedupe and stable ordering for monotonic comparisons.
  const requirements = dedupeRequirements(result.requirements).sort((a, b) => requirementKey(a).localeCompare(requirementKey(b)));
  const satisfied = dedupeRequirements(result.satisfied_requirements).sort((a, b) =>
    requirementKey(a).localeCompare(requirementKey(b))
  );

  return {
    ...result,
    requirements,
    satisfied_requirements: satisfied
  };
};
