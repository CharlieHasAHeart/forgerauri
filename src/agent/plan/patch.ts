import type { PlanChangeRequestV2, PlanPatchOperation, PlanV1 } from "./schema.js";
import { planV1Schema } from "./schema.js";

const insertAfter = <T extends { id: string }>(items: T[], item: T, afterId?: string): T[] => {
  if (!afterId) return [item, ...items];
  const idx = items.findIndex((entry) => entry.id === afterId);
  if (idx < 0) return [...items, item];
  return [...items.slice(0, idx + 1), item, ...items.slice(idx + 1)];
};

const reorderAfter = <T extends { id: string }>(items: T[], taskId: string, afterId?: string): T[] => {
  const idx = items.findIndex((entry) => entry.id === taskId);
  if (idx < 0) return items;
  const task = items[idx]!;
  const without = [...items.slice(0, idx), ...items.slice(idx + 1)];
  return insertAfter(without, task, afterId);
};

const applyPatchAction = (plan: PlanV1, patchAction: PlanPatchOperation): PlanV1 => {
  const next: PlanV1 = {
    ...plan,
    milestones: [...plan.milestones],
    tasks: [...plan.tasks]
  };

  if (patchAction.action === "tasks.add") {
    if (next.tasks.some((task) => task.id === patchAction.task.id)) {
      throw new Error(`tasks.add duplicate id '${patchAction.task.id}'`);
    }
    next.tasks = insertAfter(next.tasks, patchAction.task, patchAction.after_task_id);
    return next;
  }

  if (patchAction.action === "tasks.remove") {
    next.tasks = next.tasks.filter((task) => task.id !== patchAction.task_id);
    next.milestones = next.milestones.map((milestone) => ({
      ...milestone,
      task_ids: milestone.task_ids.filter((id) => id !== patchAction.task_id)
    }));
    return next;
  }

  if (patchAction.action === "tasks.update") {
    const idx = next.tasks.findIndex((task) => task.id === patchAction.task_id);
    if (idx < 0) throw new Error(`tasks.update unknown id '${patchAction.task_id}'`);
    next.tasks[idx] = {
      ...next.tasks[idx]!,
      ...patchAction.changes,
      id: next.tasks[idx]!.id
    };
    return next;
  }

  if (patchAction.action === "tasks.reorder") {
    next.tasks = reorderAfter(next.tasks, patchAction.task_id, patchAction.after_task_id);
    return next;
  }

  if (patchAction.action === "acceptance.update") {
    const changes = patchAction.changes as Record<string, unknown>;
    if (typeof changes.locked === "boolean") {
      next.acceptance_locked = changes.locked;
    }
    return next;
  }

  if (patchAction.action === "techStack.update") {
    const changes = patchAction.changes as Record<string, unknown>;
    if (typeof changes.locked === "boolean") {
      next.tech_stack_locked = changes.locked;
    }
    return next;
  }

  return next;
};

export const applyPlanChangePatch = (current: PlanV1, request: PlanChangeRequestV2): PlanV1 => {
  let next = {
    ...current,
    milestones: [...current.milestones],
    tasks: [...current.tasks]
  };

  for (const patchAction of request.patch) {
    next = applyPatchAction(next, patchAction);
  }

  const parsed = planV1Schema.safeParse(next);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
    throw new Error(`plan patch produced invalid PlanV1: ${details}`);
  }

  return parsed.data;
};
