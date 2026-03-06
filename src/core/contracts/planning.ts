import type { AgentPolicy } from "./policy.js";
import type { ToolSpec } from "./tools.js";
import type { Milestone, PlanTask, PlanV1, PlanV2, SuccessCriterion } from "../planning/Plan.js";
import type { PlanChangeRequestV2, PlanPatchOperation, ToolCall } from "../planning/actions.js";
import type { ContextPacket, Evidence } from "./context.js";

export type { Milestone, PlanTask, PlanV1, PlanV2, SuccessCriterion, PlanChangeRequestV2, PlanPatchOperation, ToolCall };

export type Planner = {
  proposePlan: (args: {
    context: ContextPacket;
    registry: Record<string, ToolSpec<any>>;
    policy: AgentPolicy;
  }) => Promise<{ plan: PlanV2; raw: string; responseId?: string; usage?: unknown; previousResponseIdSent?: string }>;
  proposeToolCallsForTask: (args: {
    context: ContextPacket;
    task: PlanTask;
    registry: Record<string, ToolSpec<any>>;
    policy: AgentPolicy;
  }) => Promise<{ toolCalls: ToolCall[]; raw: string; responseId?: string; usage?: unknown; previousResponseIdSent?: string }>;
  proposePlanChange: (args: {
    context: ContextPacket;
    currentPlan: PlanV2;
    evidence?: Evidence;
    registry: Record<string, ToolSpec<any>>;
    policy: AgentPolicy;
  }) => Promise<{ changeRequest: PlanChangeRequestV2; raw: string; responseId?: string; usage?: unknown; previousResponseIdSent?: string }>;
};
