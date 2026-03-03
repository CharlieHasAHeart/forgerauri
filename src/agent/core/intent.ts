export type BootstrapIntent = {
  type: "bootstrap";
  fingerprints: string[];
};

export type EnsurePathsIntent = {
  type: "ensure_paths";
  expected_paths: string[];
};

export type VerifyToolExitIntent = {
  type: "verify_tool_exit";
  tool_name: string;
  expect_exit_code: number;
};

export type VerifyCommandIntent = {
  type: "verify_command";
  cmd: string;
  args: string[];
  cwd?: string;
  expect_exit_code: number;
};

export type VerifyAcceptancePipelineIntent = {
  type: "verify_acceptance_pipeline";
  pipeline_id: string;
  cwd?: string;
  strict_order?: boolean;
};

export type Intent =
  | BootstrapIntent
  | EnsurePathsIntent
  | VerifyToolExitIntent
  | VerifyCommandIntent
  | VerifyAcceptancePipelineIntent;
