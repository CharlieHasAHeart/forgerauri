import type { LlmProvider } from "../../llm/provider.js";
import {
  planChangeReviewOutcomeSchema,
  type GateResult,
  type PlanChangeRequestV2,
  type PlanChangeReviewOutcome
} from "../plan/schema.js";

export const interpretPlanChangeReview = async (args: {
  provider: LlmProvider;
  request: PlanChangeRequestV2;
  gateResult: GateResult;
  policySummary: {
    acceptanceLocked: boolean;
    techStackLocked: boolean;
    allowedTools: string[];
  };
  userInput: string;
  previousResponseId?: string;
  truncation?: "auto" | "disabled";
  contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
}): Promise<{ outcome: PlanChangeReviewOutcome; attempts: number; raw: string; responseId?: string }> => {
  const response = await args.provider.completeJSON(
    [
      {
        role: "system",
        content:
          "Interpret user natural-language feedback for a plan change review. " +
          "Return strict JSON only. " +
          "If user rejects, output decision=denied with non-empty guidance and no patch. " +
          "If user approves, output decision=approved with patch array only. " +
          "Patch operations must use `action` (not `op`) and allowed actions are: " +
          "tasks.add, tasks.remove, tasks.update, tasks.reorder, acceptance.update, techStack.update."
      },
      {
        role: "user",
        content: JSON.stringify({
          gate_result: args.gateResult,
          policy_summary: args.policySummary,
          proposed_change_request: args.request,
          user_feedback: args.userInput
        })
      }
    ],
    planChangeReviewOutcomeSchema,
    {
      previousResponseId: args.previousResponseId,
      instructions:
        "Decide approve/deny based on user feedback. " +
        "For approved, provide final patch to apply using action-based operations. " +
        "For denied, provide actionable guidance.",
      truncation: args.truncation,
      contextManagement: args.contextManagement
    }
  );

  return {
    outcome: response.data,
    attempts: response.attempts,
    raw: response.raw,
    responseId: response.responseId
  };
};
