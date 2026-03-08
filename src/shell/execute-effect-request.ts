import {
  isEffectRequest,
  isEffectRequestKind,
  type EffectRequest,
  type EffectResult
} from "../protocol/index.js";
import { buildEffectResultFromActionResults } from "./build-effect-result-from-actions.js";
import { executeActions } from "./action-executor.js";
import { buildRunReviewEffectResult } from "./build-run-review-effect-result.js";
import { extractActionsFromEffectRequest } from "./extract-actions-from-effect-request.js";

export function buildUnsupportedEffectResult(request: EffectRequest): EffectResult {
  return {
    kind: "action_results",
    success: false,
    payload: {
      reason: "unsupported_effect_request",
      requestKind: request.kind
    },
    context: {
      handled: false
    }
  };
}

export function buildExecuteActionsEffectResult(request: EffectRequest): EffectResult {
  const actions = extractActionsFromEffectRequest(request);
  const results = executeActions(actions);

  return buildEffectResultFromActionResults(request, results);
}

export { buildRunReviewEffectResult };

export function buildInvalidEffectResult(requestKind: string | undefined): EffectResult {
  return {
    kind: "action_results",
    success: false,
    payload: {
      reason: "invalid_effect_request",
      requestKind: requestKind ?? "unknown"
    },
    context: {
      handled: false
    }
  };
}

export function executeEffectRequest(
  request: EffectRequest | undefined
): EffectResult | undefined {
  if (!request) {
    return undefined;
  }

  if (!isEffectRequest(request)) {
    return buildInvalidEffectResult(undefined);
  }

  if (!isEffectRequestKind(request.kind)) {
    return buildInvalidEffectResult(request.kind);
  }

  if (request.kind === "execute_actions") {
    return buildExecuteActionsEffectResult(request);
  }

  if (request.kind === "run_review") {
    return buildRunReviewEffectResult(request);
  }

  return buildUnsupportedEffectResult(request);
}

export function canExecuteEffectRequest(request: EffectRequest | undefined): boolean {
  if (!request) {
    return false;
  }

  if (!isEffectRequest(request)) {
    return false;
  }

  return isEffectRequestKind(request.kind);
}
