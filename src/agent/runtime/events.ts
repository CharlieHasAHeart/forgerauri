export type AgentEvent =
  | { type: "plan_proposed"; taskCount: number }
  | { type: "turn_start"; turn: number; maxTurns: number }
  | { type: "task_selected"; taskId: string }
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string; ok: boolean; note?: string }
  | { type: "criteria_result"; ok: boolean; failures: string[] }
  | { type: "patch_generated"; paths: string[] }
  | { type: "replan_proposed" }
  | { type: "replan_gate"; status: "needs_user_review" | "denied"; reason: string; guidance?: string }
  | { type: "replan_review_text"; text: string }
  | { type: "replan_applied"; newVersion: number }
  | { type: "done"; auditPath?: string }
  | { type: "failed"; message?: string; auditPath?: string };

