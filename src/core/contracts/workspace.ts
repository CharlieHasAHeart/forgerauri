export type Workspace = {
  root: string;
  runDir: string;
  inputs?: {
    spec?: unknown;
    specRef?: string;
    [k: string]: unknown;
  };
  paths: Record<string, string>;
  derived?: Record<string, unknown>;
};
