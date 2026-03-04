export type SuccessCriterion =
  | { type: "tool_result"; tool_name: string; expected_ok?: boolean }
  | { type: "file_exists"; path: string }
  | { type: "file_contains"; path: string; contains: string }
  | { type: "command"; cmd: string; args?: string[]; cwd?: string; expect_exit_code?: number };

export type PlanTask = {
  id: string;
  title: string;
  description?: string;
  dependencies: string[];
  success_criteria: SuccessCriterion[];
};

export type PlanV1 = {
  version: "v1";
  goal: string;
  tasks: PlanTask[];
};
