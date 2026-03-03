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

export type Intent = BootstrapIntent | EnsurePathsIntent | VerifyToolExitIntent;

