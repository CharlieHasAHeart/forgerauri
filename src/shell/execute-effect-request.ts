import {
  isEffectRequest,
  isEffectRequestKind,
  type EffectRequest,
  type EffectResult
} from "../protocol/index.js";

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
  return {
    kind: "action_results",
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

export function executeEffectRequest(
  request: EffectRequest | undefined
): EffectResult | undefined {
  if (!request) {
    return undefined;
  }

  if (!isEffectRequest(request)) {
    return undefined;
  }

  if (!isEffectRequestKind(request.kind)) {
    return undefined;
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
