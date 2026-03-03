export type AcceptanceCommand = {
  id: string;
  cmd: "pnpm" | "cargo" | "tauri" | "node";
  args: string[];
  cwd_policy: "repo_root" | "app_dir" | "tauri_dir" | { explicit: string };
  expect_exit_code: number;
  description: string;
};

export type AcceptancePipeline = {
  id: string;
  description: string;
  steps: Array<{ command_id: string; optional?: boolean }>;
  strict_order?: boolean;
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
    strict_order: false
  }
];

export const DEFAULT_ACCEPTANCE_PIPELINE_ID = "desktop_tauri_default";

export const getAcceptanceCommand = (id: string): AcceptanceCommand | undefined =>
  acceptanceCommands.find((command) => command.id === id);

export const getAcceptancePipeline = (id: string): AcceptancePipeline | undefined =>
  acceptancePipelines.find((pipeline) => pipeline.id === id);

export const listAcceptanceCommands = (): AcceptanceCommand[] => [...acceptanceCommands];

export const listAcceptancePipelines = (): AcceptancePipeline[] => [...acceptancePipelines];

