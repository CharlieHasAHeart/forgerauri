import { isAction, isEffectRequest, type Action, type EffectRequest } from "../protocol/index.js";

export function extractActionsFromEffectRequest(
  request: EffectRequest | undefined
): Action[] {
  if (!request) {
    return [];
  }

  if (!isEffectRequest(request)) {
    return [];
  }

  if (request.kind !== "execute_actions") {
    return [];
  }

  const payload = request.payload;

  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const actions = Reflect.get(payload, "actions");

  if (!Array.isArray(actions)) {
    return [];
  }

  return actions.filter((action): action is Action => isAction(action));
}

export function canExtractActionsFromEffectRequest(
  request: EffectRequest | undefined
): boolean {
  return extractActionsFromEffectRequest(request).length > 0;
}
