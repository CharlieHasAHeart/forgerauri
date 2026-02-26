import { applyPlanChangePatch } from "./patch.js";
import type { PlanChangeRequestV1, PlanChangeRequestV2, PlanV1 } from "./schema.js";

export const summarizePlan = (plan: PlanV1): { milestones: number; tasks: number; locked: { acceptance: boolean; techStack: boolean } } => ({
  milestones: plan.milestones.length,
  tasks: plan.tasks.length,
  locked: {
    acceptance: plan.acceptance_locked,
    techStack: plan.tech_stack_locked
  }
});

export const getNextReadyTask = (plan: PlanV1, completedTaskIds: Set<string>): PlanV1["tasks"][number] | undefined => {
  for (const task of plan.tasks) {
    if (completedTaskIds.has(task.id)) continue;
    const ready = task.dependencies.every((dep) => completedTaskIds.has(dep));
    if (ready) return task;
  }
  return undefined;
};

export const applyPlanChange = (current: PlanV1, request: PlanChangeRequestV1 | PlanChangeRequestV2): PlanV1 => {
  if (request.version === "v1") {
    if (request.proposed_plan) return request.proposed_plan;
    return current;
  }
  return applyPlanChangePatch(current, request);
};
