import { z } from "zod";
import type { LlmProvider } from "../../llm/provider.js";
import type { AgentPolicy } from "../policy/policy.js";
import type { PlanChangeRequestV2, PlanV1 } from "../plan/schema.js";
import { planChangeRequestV2Schema, planV1Schema } from "../plan/schema.js";
import { llmJson } from "./json_extract.js";
import { DEFAULT_PLAN_CHANGE_INSTRUCTIONS, DEFAULT_PLAN_INSTRUCTIONS } from "./prompts.js";
import { renderToolIndex } from "./tool_index.js";
import type { ToolSpec } from "../tools/types.js";

export const proposePlan = async (args: {
  goal: string;
  provider: LlmProvider;
  registry: Record<string, ToolSpec>;
  stateSummary: unknown;
  policy: AgentPolicy;
  maxToolCallsPerTurn: number;
  previousResponseId?: string;
  instructions?: string;
  truncation?: "auto" | "disabled";
  contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
}): Promise<{
  plan: PlanV1;
  raw: string;
  responseId?: string;
  usage?: unknown;
  previousResponseIdSent?: string;
}> => {
  const instructions = args.instructions ?? DEFAULT_PLAN_INSTRUCTIONS;

  const toolIndex = renderToolIndex(args.registry);

  const result = await llmJson({
    provider: args.provider,
    schema: planV1Schema,
    instructions,
    previousResponseId: args.previousResponseId,
    truncation: args.truncation,
    contextManagement: args.contextManagement,
    maxOutputTokens: 4500,
    messages: [
      {
        role: "user",
        content:
          `Create PlanV1 for this goal:\n${args.goal}\n\n` +
          `Tech stack constraints (locked unless user allows):\n${JSON.stringify(
            args.policy,
            null,
            2
          )}\n\n` +
          `Tool index:\n${toolIndex}\n\n` +
          `Repo state summary:\n${JSON.stringify(args.stateSummary, null, 2)}\n\n` +
          `Planning constraints:\n${JSON.stringify(
            {
              maxSteps: args.policy.budgets.max_steps,
              maxToolCallsPerTurn: args.maxToolCallsPerTurn,
              acceptanceLocked: args.policy.acceptance.locked,
              techStackLocked: args.policy.tech_stack_locked
            },
            null,
            2
          )}\n` +
          "Every task must include success_criteria with machine-checkable command/file checks."
      }
    ]
  });

  return {
    plan: result.data,
    raw: result.raw,
    responseId: result.responseId,
    usage: result.usage,
    previousResponseIdSent: result.previousResponseIdSent
  };
};

export const proposePlanChange = async (args: {
  provider: LlmProvider;
  goal: string;
  currentPlan: PlanV1;
  policy: AgentPolicy;
  stateSummary: unknown;
  failureEvidence: string[];
  previousResponseId?: string;
  instructions?: string;
  truncation?: "auto" | "disabled";
  contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
}): Promise<{
  changeRequest: PlanChangeRequestV2;
  raw: string;
  responseId?: string;
  usage?: unknown;
  previousResponseIdSent?: string;
}> => {
  const instructions = args.instructions ?? DEFAULT_PLAN_CHANGE_INSTRUCTIONS;

  const result = await llmJson({
    provider: args.provider,
    schema: planChangeRequestV2Schema,
    instructions,
    previousResponseId: args.previousResponseId,
    truncation: args.truncation,
    contextManagement: args.contextManagement,
    messages: [
      {
        role: "user",
        content:
          `Goal:\n${args.goal}\n\n` +
          `Current plan:\n${JSON.stringify(args.currentPlan, null, 2)}\n\n` +
          `Policy:\n${JSON.stringify(args.policy, null, 2)}\n\n` +
          `Failure evidence:\n${JSON.stringify(args.failureEvidence, null, 2)}\n\n` +
          `State summary:\n${JSON.stringify(args.stateSummary, null, 2)}\n` +
          "Return PlanChangeRequestV2 JSON only."
      }
    ]
  });

  return {
    changeRequest: result.data,
    raw: result.raw,
    responseId: result.responseId,
    usage: result.usage,
    previousResponseIdSent: result.previousResponseIdSent
  };
};
