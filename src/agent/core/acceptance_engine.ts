import type { EvidenceEvent } from "./evidence.js";
import type { BootstrapIntent, EnsurePathsIntent, Intent, VerifyToolExitIntent } from "./intent.js";
import { normalizePath } from "./path_normalizer.js";
import { dedupeRequirements, requirementKey, type FileExistsRequirement, type Requirement, type ToolExitCodeRequirement } from "./requirement.js";
import type { WorkspaceSnapshot } from "./workspace_snapshot.js";

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

export const evaluateAcceptance = (input: EvalInput): EvaluationResult => {
  void input.goal;
  let result: EvaluationResult;
  if (input.intent.type === "bootstrap") {
    result = evaluateBootstrapIntent({ ...input, intent: input.intent });
  } else if (input.intent.type === "ensure_paths") {
    result = evaluateEnsurePathsIntent({ ...input, intent: input.intent });
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
