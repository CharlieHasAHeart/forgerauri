// desktop_tauri_default is the golden desktop acceptance pipeline.
// verify_project execution and acceptance verification must both use this catalog as the single source of truth.
export type AcceptanceCommand = {
  id: string;
  cmd: "pnpm" | "cargo" | "tauri" | "node";
  args: string[];
  cwd_policy: "repo_root" | "app_dir" | "tauri_dir" | { explicit: string };
  expect_exit_code: number;
  description: string;
};

export type AcceptancePipelineExecution = {
  retries?: Partial<Record<string, { maxAttempts: number; retryOn?: "nonzero_exit" | "deps_signal" | "always" }>>;
  prechecks?: Array<
    | { kind: "skip_if_exists"; path: string; command_id: string }
    | { kind: "skip_if_cmd_ran_ok"; command_id: string }
  >;
};

export type AcceptancePipeline = {
  id: string;
  description: string;
  steps: Array<{ command_id: string; optional?: boolean }>;
  strict_order?: boolean;
  execution?: AcceptancePipelineExecution;
};

const acceptanceCommands: AcceptanceCommand[] = [
  {
    id: "pnpm_install",
    cmd: "pnpm",
    args: ["install"],
    cwd_policy: "app_dir",
    expect_exit_code: 0,
    description: "Install JS dependencies in app workspace."
  },
  {
    id: "pnpm_build",
    cmd: "pnpm",
    args: ["build"],
    cwd_policy: "app_dir",
    expect_exit_code: 0,
    description: "Build frontend bundle."
  },
  {
    id: "cargo_check",
    cmd: "cargo",
    args: ["check"],
    cwd_policy: "tauri_dir",
    expect_exit_code: 0,
    description: "Compile-check Rust/Tauri backend."
  },
  {
    id: "pnpm_tauri_help",
    cmd: "pnpm",
    args: ["tauri", "--help"],
    cwd_policy: "app_dir",
    expect_exit_code: 0,
    description: "Validate tauri cli availability."
  },
  {
    id: "pnpm_tauri_build",
    cmd: "pnpm",
    args: ["tauri", "build"],
    cwd_policy: "app_dir",
    expect_exit_code: 0,
    description: "Run production tauri build."
  }
];

const acceptancePipelines: AcceptancePipeline[] = [
  {
    id: "desktop_tauri_default",
    description:
      "Standard desktop acceptance pipeline: install(if needed) -> build -> cargo check -> tauri --help -> tauri build.",
    steps: [
      { command_id: "pnpm_install", optional: true },
      { command_id: "pnpm_build" },
      { command_id: "cargo_check" },
      { command_id: "pnpm_tauri_help" },
      { command_id: "pnpm_tauri_build" }
    ],
    strict_order: false,
    execution: {
      retries: {
        pnpm_install: { maxAttempts: 2, retryOn: "nonzero_exit" },
        pnpm_build: { maxAttempts: 2, retryOn: "deps_signal" },
        cargo_check: { maxAttempts: 1, retryOn: "nonzero_exit" },
        pnpm_tauri_help: { maxAttempts: 1, retryOn: "nonzero_exit" },
        pnpm_tauri_build: { maxAttempts: 1, retryOn: "nonzero_exit" }
      },
      prechecks: [
        { kind: "skip_if_exists", path: "node_modules", command_id: "pnpm_install" },
        { kind: "skip_if_cmd_ran_ok", command_id: "pnpm_install" }
      ]
    }
  }
];

export const DEFAULT_ACCEPTANCE_PIPELINE_ID = "desktop_tauri_default";

export const getAcceptanceCommand = (id: string): AcceptanceCommand | undefined =>
  acceptanceCommands.find((command) => command.id === id);

export const getAcceptancePipeline = (id: string): AcceptancePipeline | undefined =>
  acceptancePipelines.find((pipeline) => pipeline.id === id);

export const listAcceptanceCommands = (): AcceptanceCommand[] => [...acceptanceCommands];

export const listAcceptancePipelines = (): AcceptancePipeline[] => [...acceptancePipelines];
