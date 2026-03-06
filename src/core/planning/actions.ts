import type { Milestone, PlanTask } from "./Plan.js";

export type ToolCall = { name: string; input: unknown; on_fail?: "stop" | "continue" };

export type PlanPatchOperation =
  | { action: "tasks.add"; task: PlanTask; after_task_id?: string; milestone_id?: string }
  | { action: "tasks.remove"; task_id: string }
  | { action: "tasks.update"; task_id: string; changes: Partial<PlanTask>; milestone_id?: string }
  | { action: "tasks.reorder"; task_id: string; after_task_id?: string; milestone_id?: string }
  | { action: "milestones.add"; milestone: Milestone; after_milestone_id?: string }
  | { action: "acceptance.update"; changes: Record<string, unknown> }
  | { action: "techStack.update"; changes: Record<string, unknown> };

export type PlanChangeRequestV2 = {
  version: "v2";
  reason: string;
  change_type: string;
  impact?: Record<string, unknown>;
  patch: PlanPatchOperation[];
};
