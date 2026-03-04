import type { AgentPolicy } from "./policy.js";
import type { LlmPort } from "./llm.js";
import type { ToolSpec } from "./tools.js";
import type { PlanTask, PlanV1, SuccessCriterion } from "../planning/Plan.js";
import type { PlanChangeRequestV2, PlanPatchOperation, ToolCall } from "../planning/actions.js";

export type { PlanTask, PlanV1, SuccessCriterion, PlanChangeRequestV2, PlanPatchOperation, ToolCall };

export type Planner = {
  proposePlan: (args: {
    goal: string;
    provider: LlmPort;
    registry: Record<string, ToolSpec<any>>;
    stateSummary: unknown;
    policy: AgentPolicy;
    maxToolCallsPerTurn: number;
    instructions: string;
    previousResponseId?: string;
    truncation?: "auto" | "disabled";
    contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
  }) => Promise<{ plan: PlanV1; raw: string; responseId?: string; usage?: unknown; previousResponseIdSent?: string }>;
  proposeToolCallsForTask?: (args: {
    goal: string;
    provider: LlmPort;
    policy: AgentPolicy;
    task: PlanTask;
    planSummary: unknown;
    stateSummary: unknown;
    registry: Record<string, ToolSpec<any>>;
    recentFailures: string[];
    maxToolCallsPerTurn: number;
    previousResponseId?: string;
    truncation?: "auto" | "disabled";
    contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
  }) => Promise<{ toolCalls: ToolCall[]; raw: string; responseId?: string; usage?: unknown; previousResponseIdSent?: string }>;
  proposePlanChange?: (args: {
    provider: LlmPort;
    goal: string;
    currentPlan: PlanV1;
    policy: AgentPolicy;
    stateSummary: unknown;
    failureEvidence: string[];
    previousResponseId?: string;
    instructions: string;
    truncation?: "auto" | "disabled";
    contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
  }) => Promise<{ changeRequest: PlanChangeRequestV2; raw: string; responseId?: string; usage?: unknown; previousResponseIdSent?: string }>;
};

export const PLAN_INSTRUCTIONS =
  "Generate a deterministic plan-first response. Use concise, machine-checkable tasks and stable IDs.";
