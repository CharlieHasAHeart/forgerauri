import type { PlanTask } from "../plan/schema.js";

export const buildCriterionToolCall = (
  criterion: PlanTask["success_criteria"][number]
): { name: string; input: unknown } | null => {
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
