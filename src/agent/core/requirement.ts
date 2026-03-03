export type ToolOkRequirement = {
  kind: "tool_ok";
  tool_name: string;
};

export type ToolExitCodeRequirement = {
  kind: "tool_exit_code";
  tool_name: string;
  expect_exit_code: number;
};

export type FileExistsRequirement = {
  kind: "file_exists";
  path: string;
};

export type FileHashRequirement = {
  kind: "file_hash";
  path: string;
  sha256: string;
};

export type Requirement = ToolOkRequirement | ToolExitCodeRequirement | FileExistsRequirement | FileHashRequirement;

export const requirementKey = (requirement: Requirement): string => {
  switch (requirement.kind) {
    case "tool_ok":
      return `tool_ok:${requirement.tool_name}`;
    case "tool_exit_code":
      return `tool_exit_code:${requirement.tool_name}:${requirement.expect_exit_code}`;
    case "file_exists":
      return `file_exists:${requirement.path}`;
    case "file_hash":
      return `file_hash:${requirement.path}:${requirement.sha256}`;
  }
};

export const dedupeRequirements = <T extends Requirement>(requirements: T[]): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const requirement of requirements) {
    const key = requirementKey(requirement);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(requirement);
  }
  return out;
};

