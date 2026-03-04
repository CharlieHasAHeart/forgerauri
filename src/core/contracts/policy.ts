export type AgentPolicy = {
  tech_stack: Record<string, unknown>;
  tech_stack_locked: boolean;
  acceptance: {
    locked: boolean;
    criteria?: Array<Record<string, unknown>>;
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
