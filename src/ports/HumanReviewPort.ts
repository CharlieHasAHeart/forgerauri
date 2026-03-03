import type { AgentEvent } from "../core/agent/events.js";
import type { HumanReviewFn, PlanChangeReviewFn } from "../core/agent/contracts.js";

export type HumanReviewPort = {
  humanReview?: HumanReviewFn;
  requestPlanChangeReview?: PlanChangeReviewFn;
  onEvent?: (event: AgentEvent) => void;
};
