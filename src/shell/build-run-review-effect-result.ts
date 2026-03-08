import { type EffectRequest, type EffectResult } from "../protocol/index.js";

export function buildRunReviewEffectResult(request: EffectRequest): EffectResult {
  return {
    kind: "review_result",
    success: true,
    payload: {
      accepted: true,
      requestKind: request.kind
    },
    context: {
      handled: true
    }
  };
}
