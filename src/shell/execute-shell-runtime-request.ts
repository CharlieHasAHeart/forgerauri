import { type EffectRequest, type EffectResult } from "../protocol/index.js";
import { executeEffectRequest } from "./execute-effect-request.js";

export function executeShellRuntimeRequest(
  request: EffectRequest | undefined
): EffectResult | undefined {
  if (!request) {
    return undefined;
  }

  return executeEffectRequest(request);
}
