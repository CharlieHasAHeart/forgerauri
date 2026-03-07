import {
  isPlan,
  isTask,
  isTaskStatus,
  type AgentState,
  type Plan,
  type Task
} from "../protocol/index.js";

export function isRunnableTask(task: Task): boolean {
  if (!isTaskStatus(task.status)) {
    return false;
  }

  return task.status === "ready" || task.status === "pending";
}

export function getPlanTaskIds(plan: Plan): string[] {
  if (!plan.taskIds) {
    return [];
  }

  return [...plan.taskIds];
}

export function findTaskById(tasks: Task[], taskId: string): Task | undefined {
  return tasks.find((task) => task.id === taskId);
}

export function selectNextTaskFromPlan(plan: Plan, tasks: Task[]): Task | undefined {
  const taskIds = getPlanTaskIds(plan);

  for (const taskId of taskIds) {
    const task = findTaskById(tasks, taskId);
    if (task && isRunnableTask(task)) {
      return task;
    }
  }

  return undefined;
}

export function selectNextTask(
  state: AgentState,
  plan: Plan | undefined,
  tasks: Task[]
): Task | undefined {
  if (!plan || !isPlan(plan)) {
    return undefined;
  }

  const validTasks = tasks.filter((task): task is Task => isTask(task));

  if (state.currentTaskId) {
    const currentTask = findTaskById(validTasks, state.currentTaskId);
    if (currentTask && isRunnableTask(currentTask)) {
      return currentTask;
    }
  }

  return selectNextTaskFromPlan(plan, validTasks);
}

export function hasRunnableTask(plan: Plan, tasks: Task[]): boolean {
  return selectNextTaskFromPlan(plan, tasks) !== undefined;
}
