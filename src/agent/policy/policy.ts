import type { SuccessCriteria } from "../plan/schema.js";

export type AgentPolicy = {
  tech_stack: Record<string, unknown>;
  tech_stack_locked: boolean;
  acceptance: {
    locked: boolean;
    criteria?: SuccessCriteria[];
  };
  safety: {
    allowed_tools: string[];
    allowed_commands: string[];
  };
  budgets: {
    max_steps: number;
    max_actions_per_task: number;
    max_retries_per_task: number;
    max_replans: number;
  };
  userExplicitlyAllowedRelaxAcceptance?: boolean;
};

export const defaultAgentPolicy = (args: {
  maxSteps: number;
  maxActionsPerTask: number;
  maxRetriesPerTask: number;
  maxReplans: number;
  allowedTools: string[];
}): AgentPolicy => ({
  tech_stack: {
    app: "desktop",
    frontend: "svelte+ts",
    backend: "tauri+rust",
    database: "sqlite+rusqlite"
  },
  tech_stack_locked: true,
  acceptance: {
    locked: true,
    criteria: []
  },
  safety: {
    allowed_tools: [...args.allowedTools].sort((a, b) => a.localeCompare(b)),
    allowed_commands: ["pnpm", "cargo", "node", "tauri"]
  },
  budgets: {
    max_steps: args.maxSteps,
    max_actions_per_task: args.maxActionsPerTask,
    max_retries_per_task: args.maxRetriesPerTask,
    max_replans: args.maxReplans
  },
  userExplicitlyAllowedRelaxAcceptance: false
});
