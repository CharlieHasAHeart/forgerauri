export type FailureClass = "system" | "task";

export type FailureSignal = {
  class: FailureClass;
  kind:
    | "PlannerOutputInvalid"
    | "MissingBaseRoot"
    | "ToolInputInvalid"
    | "UnknownTool"
    | "PolicyBlockedTool"
    | "OtherSystem"
    | "TaskCriteriaFailed";
  message: string;
  fingerprint: string;
};

export const fingerprintFailure = (kind: FailureSignal["kind"], message: string): string => {
  const norm = message
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[0-9]+/g, "<n>")
    .slice(0, 220);
  return `${kind}:${norm}`;
};

export const classifyFailure = (args: {
  criteriaFailures: string[];
  lastErrorMessage?: string;
  toolAuditErrors?: string[];
}): FailureSignal => {
  const all = [
    ...(args.toolAuditErrors ?? []),
    ...(args.criteriaFailures ?? []),
    ...(args.lastErrorMessage ? [args.lastErrorMessage] : [])
  ].filter((x) => typeof x === "string" && x.length > 0);

  const text = all.join(" | ").toLowerCase();

  const mk = (kind: FailureSignal["kind"], message: string, cls: FailureClass): FailureSignal => ({
    class: cls,
    kind,
    message,
    fingerprint: fingerprintFailure(kind, message)
  });

  if (text.includes("invalid input: expected object, received undefined") || text.includes("expected object, received undefined")) {
    return mk("ToolInputInvalid", all[0] ?? "Invalid tool input (undefined)", "system");
  }
  if (text.includes("base root 'appdir' is not available") || (text.includes("base root") && text.includes("not available"))) {
    return mk("MissingBaseRoot", all.find((x) => x.toLowerCase().includes("base root")) ?? "Base root missing", "system");
  }
  if (text.includes("unknown tool")) {
    return mk("UnknownTool", all.find((x) => x.toLowerCase().includes("unknown tool")) ?? "Unknown tool", "system");
  }
  if (text.includes("blocked by policy")) {
    return mk("PolicyBlockedTool", all.find((x) => x.toLowerCase().includes("blocked by policy")) ?? "Tool blocked by policy", "system");
  }

  if ((args.criteriaFailures ?? []).length > 0) {
    return mk("TaskCriteriaFailed", args.criteriaFailures[0], "task");
  }

  return mk("OtherSystem", all[0] ?? "System failure", "system");
};
