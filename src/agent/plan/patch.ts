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

const applyPatchOp = (plan: PlanV1, op: PlanPatchOperation): PlanV1 => {
  const next: PlanV1 = {
    ...plan,
    milestones: [...plan.milestones],
    tasks: [...plan.tasks]
  };

  if (op.op === "add_task") {
    if (next.tasks.some((task) => task.id === op.task.id)) {
      throw new Error(`add_task duplicate id '${op.task.id}'`);
    }
    next.tasks = insertAfter(next.tasks, op.task, op.after_task_id);
    return next;
  }

  if (op.op === "remove_task") {
    next.tasks = next.tasks.filter((task) => task.id !== op.task_id);
    next.milestones = next.milestones.map((milestone) => ({
      ...milestone,
      task_ids: milestone.task_ids.filter((id) => id !== op.task_id)
    }));
    return next;
  }

  if (op.op === "edit_task") {
    const idx = next.tasks.findIndex((task) => task.id === op.task_id);
    if (idx < 0) throw new Error(`edit_task unknown id '${op.task_id}'`);
    next.tasks[idx] = {
      ...next.tasks[idx]!,
      ...op.changes,
      id: next.tasks[idx]!.id
    };
    return next;
  }

  if (op.op === "reorder") {
    next.tasks = reorderAfter(next.tasks, op.task_id, op.after_task_id);
    return next;
  }

  if (op.op === "edit_acceptance") {
    const changes = op.changes as Record<string, unknown>;
    if (typeof changes.locked === "boolean") {
      next.acceptance_locked = changes.locked;
    }
    return next;
  }

  if (op.op === "edit_tech_stack") {
    const changes = op.changes as Record<string, unknown>;
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

  for (const op of request.patch) {
    next = applyPatchOp(next, op);
  }

  const parsed = planV1Schema.safeParse(next);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
    throw new Error(`plan patch produced invalid PlanV1: ${details}`);
  }

  return parsed.data;
};
