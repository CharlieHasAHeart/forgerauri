import type { AgentPolicy } from "../../contracts/policy.js";
import type { AgentState } from "../../contracts/state.js";
import type { LlmPort } from "../../contracts/llm.js";
import type { Milestone, Planner, PlanChangeRequestV2, PlanPatchOperation, PlanTask, PlanV2 } from "../../contracts/planning.js";
import type { ToolRunContext, ToolSpec } from "../../contracts/tools.js";
import type { Workspace } from "../../contracts/workspace.js";
import { setStateError } from "../execution/errors.js";
import { recordPlanChange } from "../telemetry/recorder.js";
import type { AgentTurnAuditCollector } from "../telemetry/audit.js";
import { interpretPlanChangeReview } from "../policy/plan_change_review.js";
import type { AgentEvent } from "../telemetry/events.js";
import type { PlanChangeReviewFn } from "../contracts.js";
import { ContextEngine } from "../../context_engine/ContextEngine.js";
import { serializeContextPacket } from "../../contracts/context.js";
import { storeBlob } from "../../utils/blobStore.js";

const evaluatePlanChange = (args: {
  request: PlanChangeRequestV2;
  policy: AgentPolicy;
}): { status: "needs_user_review" | "denied"; reason: string; guidance?: string } => {
  if (!Array.isArray(args.request.patch) || args.request.patch.length === 0) {
    return { status: "denied", reason: "Plan change patch is empty", guidance: "Provide at least one patch operation." };
  }

  for (const op of args.request.patch) {
    if ((op.action === "acceptance.update" && args.policy.acceptance.locked) || (op.action === "techStack.update" && args.policy.tech_stack_locked)) {
      return {
        status: "denied",
        reason: `Patch action ${op.action} is not allowed by policy lock`,
        guidance: "Avoid changing locked acceptance or tech stack fields."
      };
    }
  }

  return { status: "needs_user_review", reason: "Plan change requires user review" };
};

const moveTask = (tasks: PlanTask[], taskId: string, afterTaskId?: string): PlanTask[] => {
  const idx = tasks.findIndex((task) => task.id === taskId);
  if (idx < 0) return tasks;
  const [task] = tasks.splice(idx, 1);
  if (!afterTaskId) {
    tasks.unshift(task);
    return tasks;
  }
  const afterIdx = tasks.findIndex((item) => item.id === afterTaskId);
  if (afterIdx < 0) {
    tasks.push(task);
  } else {
    tasks.splice(afterIdx + 1, 0, task);
  }
  return tasks;
};

const cloneMilestone = (milestone: Milestone): Milestone => ({
  ...milestone,
  tasks: milestone.tasks.map((task) => ({
    ...task,
    dependencies: [...task.dependencies],
    success_criteria: [...task.success_criteria]
  })),
  acceptance: [...milestone.acceptance]
});

const findMilestoneIndexByTaskId = (milestones: Milestone[], taskId: string): number =>
  milestones.findIndex((item) => item.tasks.some((task) => task.id === taskId));

const resolveMilestoneIndex = (args: {
  milestones: Milestone[];
  milestoneId?: string;
  fallbackTaskId?: string;
  activeMilestoneId?: string;
}): number => {
  if (args.milestoneId) {
    const idx = args.milestones.findIndex((item) => item.id === args.milestoneId);
    if (idx >= 0) return idx;
  }
  if (args.fallbackTaskId) {
    const idx = findMilestoneIndexByTaskId(args.milestones, args.fallbackTaskId);
    if (idx >= 0) return idx;
  }
  if (args.activeMilestoneId) {
    const idx = args.milestones.findIndex((item) => item.id === args.activeMilestoneId);
    if (idx >= 0) return idx;
  }
  return Math.max(0, args.milestones.length - 1);
};

const applyPlanChangePatch = (plan: PlanV2, request: PlanChangeRequestV2, activeMilestoneId?: string): PlanV2 => {
  const milestones = plan.milestones.map(cloneMilestone);

  for (const op of request.patch) {
    if (op.action === "milestones.add") {
      const milestone = cloneMilestone(op.milestone);
      if (!op.after_milestone_id) {
        milestones.push(milestone);
      } else {
        const idx = milestones.findIndex((item) => item.id === op.after_milestone_id);
        if (idx < 0) milestones.push(milestone);
        else milestones.splice(idx + 1, 0, milestone);
      }
      continue;
    }

    if (op.action === "tasks.add") {
      const milestoneIndex = resolveMilestoneIndex({
        milestones,
        milestoneId: op.milestone_id,
        fallbackTaskId: op.after_task_id,
        activeMilestoneId
      });
      const targetMilestone = milestones[milestoneIndex];
      if (!targetMilestone) continue;
      const next = { ...op.task, dependencies: [...(op.task.dependencies ?? [])], success_criteria: [...(op.task.success_criteria ?? [])] };
      if (!op.after_task_id) {
        targetMilestone.tasks.push(next);
      } else {
        const afterIdx = targetMilestone.tasks.findIndex((task) => task.id === op.after_task_id);
        if (afterIdx < 0) targetMilestone.tasks.push(next);
        else targetMilestone.tasks.splice(afterIdx + 1, 0, next);
      }
      continue;
    }

    if (op.action === "tasks.remove") {
      const milestoneIndex = resolveMilestoneIndex({
        milestones,
        fallbackTaskId: op.task_id,
        activeMilestoneId
      });
      const targetMilestone = milestones[milestoneIndex];
      if (!targetMilestone) continue;
      const idx = targetMilestone.tasks.findIndex((task) => task.id === op.task_id);
      if (idx >= 0) targetMilestone.tasks.splice(idx, 1);
      continue;
    }

    if (op.action === "tasks.update") {
      const milestoneIndex = resolveMilestoneIndex({
        milestones,
        milestoneId: op.milestone_id,
        fallbackTaskId: op.task_id,
        activeMilestoneId
      });
      const targetMilestone = milestones[milestoneIndex];
      if (!targetMilestone) continue;
      const idx = targetMilestone.tasks.findIndex((task) => task.id === op.task_id);
      if (idx < 0) continue;
      targetMilestone.tasks[idx] = {
        ...targetMilestone.tasks[idx],
        ...(op.changes as Partial<PlanTask>),
        dependencies: Array.isArray((op.changes as Partial<PlanTask>).dependencies)
          ? [...((op.changes as Partial<PlanTask>).dependencies as string[])]
          : targetMilestone.tasks[idx].dependencies,
        success_criteria: Array.isArray((op.changes as Partial<PlanTask>).success_criteria)
          ? [...((op.changes as Partial<PlanTask>).success_criteria as PlanTask["success_criteria"])]
          : targetMilestone.tasks[idx].success_criteria
      };
      continue;
    }

    if (op.action === "tasks.reorder") {
      const milestoneIndex = resolveMilestoneIndex({
        milestones,
        milestoneId: op.milestone_id,
        fallbackTaskId: op.task_id,
        activeMilestoneId
      });
      const targetMilestone = milestones[milestoneIndex];
      if (!targetMilestone) continue;
      moveTask(targetMilestone.tasks, op.task_id, op.after_task_id);
      continue;
    }
  }

  return {
    ...plan,
    milestones
  };
};

export const handleReplan = async (args: {
  provider: LlmPort;
  planner: Planner;
  state: AgentState;
  policy: AgentPolicy;
  ctx: ToolRunContext;
  registry: Record<string, ToolSpec<any>>;
  workspace: Workspace;
  contextEngine: ContextEngine;
  failedTaskId: string;
  failures: string[];
  replans: number;
  audit: AgentTurnAuditCollector;
  turn: number;
  requestPlanChangeReview: PlanChangeReviewFn;
  onEvent?: (event: AgentEvent) => void;
}): Promise<{ ok: boolean; replans: number }> => {
  const { provider, planner, state, policy } = args;
  const currentPlan = state.planData;
  if (!currentPlan) {
    setStateError(state, "Config", "Missing current plan during replan");
    state.status = "failed";
    return { ok: false, replans: args.replans };
  }

  state.status = "replanning";
  const replanContext = await args.contextEngine.buildContextPacket({
    phase: "replan",
    turn: args.turn,
    state,
    ctx: args.ctx,
    registry: args.registry,
    policy,
    workspace: args.workspace,
    plan: currentPlan,
    failures: args.failures
  });
  const replanContextRef = storeBlob(args.ctx, serializeContextPacket(replanContext), "context");
  const changeProposal = await planner.proposePlanChange({
    context: replanContext,
    currentPlan,
    evidence: state.lastEvidence,
    registry: args.registry,
    policy,
  });

  args.onEvent?.({ type: "replan_proposed" });
  state.lastResponseId = changeProposal.responseId ?? state.lastResponseId;
  state.planHistory?.push({ type: "change_request", request: changeProposal.changeRequest });

  const gateResult = evaluatePlanChange({
    request: changeProposal.changeRequest,
    policy
  });

  recordPlanChange({
    audit: args.audit,
    turn: args.turn,
    llmRaw: changeProposal.raw,
    contextPacketRef: replanContextRef,
    evidenceRef: state.lastEvidence?.stderrRef ?? state.lastEvidence?.stdoutRef,
    previousResponseIdSent: changeProposal.previousResponseIdSent,
    responseId: changeProposal.responseId,
    usage: changeProposal.usage,
    gateResult
  });

  state.planHistory?.push({ type: "change_gate_result", gateResult });
  args.onEvent?.({
    type: "replan_gate",
    status: gateResult.status,
    reason: gateResult.reason,
    guidance: gateResult.guidance
  });

  if (gateResult.status === "denied") {
    state.status = "failed";
    setStateError(state, "Config", `Plan change denied: ${gateResult.reason}. Guidance: ${gateResult.guidance}`);
    return { ok: false, replans: args.replans };
  }

  const policySummary = {
    acceptanceLocked: policy.acceptance.locked,
    techStackLocked: policy.tech_stack_locked,
    allowedTools: policy.safety.allowed_tools
  };

  const userText = await args.requestPlanChangeReview({
    request: changeProposal.changeRequest,
    gateResult,
    policySummary,
    promptHint: "Use natural language: approve/reject this plan change. If rejecting, provide specific fix direction."
  });

  state.planHistory?.push({ type: "change_user_review_text", text: userText });
  args.onEvent?.({ type: "replan_review_text", text: userText.length > 240 ? `${userText.slice(0, 240)}...` : userText });

  const reviewContext = await args.contextEngine.buildContextPacket({
    phase: "review",
    turn: args.turn,
    state,
    ctx: args.ctx,
    registry: args.registry,
    policy,
    workspace: args.workspace,
    plan: currentPlan,
    failures: args.failures
  });

  const interpreted = await interpretPlanChangeReview({
    provider,
    request: changeProposal.changeRequest,
    gateResult,
    policySummary,
    userInput: userText,
    context: reviewContext,
    previousResponseId: state.lastResponseId
  });

  state.lastResponseId = interpreted.responseId ?? state.lastResponseId;
  state.planHistory?.push({ type: "change_review_outcome", outcome: interpreted.outcome });

  if (interpreted.outcome.decision === "denied") {
    state.status = "failed";
    setStateError(
      state,
      "Config",
      `Plan change denied by user review: ${interpreted.outcome.reason}. Guidance: ${interpreted.outcome.guidance}`
    );
    return { ok: false, replans: args.replans };
  }

  if (args.replans >= policy.budgets.max_replans) {
    state.status = "failed";
    setStateError(state, "Config", `Replan budget exceeded: ${args.replans} >= ${policy.budgets.max_replans}`);
    return { ok: false, replans: args.replans };
  }

  if (!interpreted.outcome.patch || interpreted.outcome.patch.length === 0) {
    state.status = "failed";
    setStateError(state, "Config", "Approved plan review outcome did not provide a patch.");
    return { ok: false, replans: args.replans };
  }

  const approvedPatchRequest: PlanChangeRequestV2 = {
    ...changeProposal.changeRequest,
    patch: interpreted.outcome.patch as PlanPatchOperation[]
  };

  state.planData = applyPlanChangePatch(currentPlan, approvedPatchRequest, state.activeMilestoneId);
  state.planVersion = (state.planVersion ?? 1) + 1;
  state.planHistory?.push({ type: "change_applied", version: state.planVersion, patch: approvedPatchRequest.patch });
  args.onEvent?.({ type: "replan_applied", newVersion: state.planVersion });
  return { ok: true, replans: args.replans + 1 };
};
