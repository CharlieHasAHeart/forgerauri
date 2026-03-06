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

export type Milestone = {
  id: string;
  title: string;
  description?: string;
  tasks: PlanTask[];
  acceptance: SuccessCriterion[];
};

export type PlanV1 = {
  version: "v1";
  goal: string;
  tasks: PlanTask[];
};

export type PlanV2 = {
  version: "v2";
  goal: string;
  milestones: Milestone[];
  goal_acceptance: SuccessCriterion[];
};
