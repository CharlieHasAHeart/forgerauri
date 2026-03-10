import { describe, expect, it } from "vitest";
import { type EffectRequest } from "../../src/protocol/index.ts";
import { executeEffectRequest } from "../../src/shell/execute-effect-request.ts";
import { executeShellRuntimeRequest } from "../../src/shell/execute-shell-runtime-request.ts";
import { runShellRuntimeStep } from "../../src/shell/run-shell-runtime.ts";
import {
  minimalAgentState,
  minimalPlan,
  minimalTasks
} from "../shared/minimal-runtime-fixtures.ts";

describe("executeShellRuntimeRequest", () => {
  it("returns undefined when request is undefined", () => {
    expect(executeShellRuntimeRequest(undefined)).toBeUndefined();
  });

  it("returns same result as executeEffectRequest for valid request", () => {
    const request: EffectRequest = {
      kind: "execute_actions",
      payload: {
        actions: [{ kind: "tool", name: "lint" }]
      }
    };

    const direct = executeShellRuntimeRequest(request);
    const expected = executeEffectRequest(request);

    expect(direct).toEqual(expected);
  });

  it("matches runShellRuntimeStep result for current runnable input", () => {
    const step = runShellRuntimeStep(minimalAgentState, minimalPlan, minimalTasks, undefined);

    expect(step.tick.request).toBeDefined();
    const viaBoundary = executeShellRuntimeRequest(step.tick.request);

    expect(step.result).toEqual(viaBoundary);
  });

  it("preserves current failure-path behavior for invalid request", () => {
    const invalidRequest = {
      kind: "unknown_kind",
      payload: {}
    } as unknown as EffectRequest;

    const result = executeShellRuntimeRequest(invalidRequest);

    expect(result).toMatchObject({
      kind: "action_results",
      success: false,
      payload: {
        reason: "invalid_effect_request",
        requestKind: "unknown"
      },
      context: {
        handled: false
      }
    });
  });
});
