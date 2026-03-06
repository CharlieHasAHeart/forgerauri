import type { PlanTask, PlanV2 } from "../../contracts/planning.js";

export const requiredInput = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
};

const tasksForScope = (plan: PlanV2, milestoneId?: string): PlanTask[] => {
  if (milestoneId) {
    return plan.milestones.find((item) => item.id === milestoneId)?.tasks ?? [];
  }
  return plan.milestones.flatMap((item) => item.tasks);
};

export const areAllTasksCompleted = (plan: PlanV2, completed: Set<string>, milestoneId?: string): boolean =>
  tasksForScope(plan, milestoneId).every((task) => completed.has(task.id));

export const getNextReadyTask = (plan: PlanV2, completed: Set<string>, milestoneId?: string): PlanTask | undefined => {
  for (const task of tasksForScope(plan, milestoneId)) {
    if (completed.has(task.id)) continue;
    const deps = task.dependencies ?? [];
    if (deps.every((dep) => completed.has(dep))) {
      return task;
    }
  }
  return undefined;
};

export const summarizePlan = (plan: PlanV2): Record<string, unknown> => ({
  version: plan.version,
  goal: plan.goal,
  milestoneCount: plan.milestones.length,
  taskCount: plan.milestones.reduce((acc, item) => acc + item.tasks.length, 0),
  milestones: plan.milestones.map((milestone) => ({
    id: milestone.id,
    title: milestone.title,
    taskCount: milestone.tasks.length,
    acceptanceCount: milestone.acceptance.length
  }))
});
