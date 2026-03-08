import { describe, expect, it } from "vitest";
import { isEffectResult, type Action, type EffectRequest } from "../../src/protocol/index.ts";
import { buildActionResult } from "../../src/shell/build-action-result.ts";
import { executeEffectRequest } from "../../src/shell/execute-effect-request.ts";

describe("executeEffectRequest", () => {
  it("returns normalized action_results for valid execute_actions request", () => {
    const request: EffectRequest = {
      kind: "execute_actions",
      payload: {
        actions: [{ kind: "tool", name: "format_code" }]
      }
    };

    const result = executeEffectRequest(request);

    expect(result).toBeDefined();
    expect(isEffectResult(result)).toBe(true);
    expect(result?.kind).toBe("action_results");
    expect(result?.success).toBe(true);
    expect(result?.context).toEqual({ requestKind: "execute_actions", handled: true });
    expect(result?.payload).toEqual({
      count: 1,
      results: [buildActionResult({ kind: "tool", name: "format_code" })]
    });
  });

  it("returns stable result for execute_actions with empty actions", () => {
    const request: EffectRequest = {
      kind: "execute_actions",
      payload: {
        actions: []
      }
    };

    const result = executeEffectRequest(request);

    expect(result).toBeDefined();
    expect(result?.kind).toBe("action_results");
    expect(result?.success).toBe(true);
    expect(result?.payload).toEqual({ count: 0, results: [] });
  });

  it("keeps only valid actions when payload.actions contains mixed items", () => {
    const mixedActions = [
      { kind: "tool", name: "run_tests" },
      { kind: "tool" },
      "not-an-action"
    ] as unknown as Action[];

    const request: EffectRequest = {
      kind: "execute_actions",
      payload: {
        actions: mixedActions
      }
    };

    const result = executeEffectRequest(request);

    expect(result).toBeDefined();
    expect(result?.kind).toBe("action_results");
    expect(result?.success).toBe(true);
    expect(result?.payload).toMatchObject({ count: 1 });
    const results = Reflect.get(result?.payload as object, "results");
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(1);
    expect(results).toEqual([buildActionResult({ kind: "tool", name: "run_tests" })]);
  });

  it("does not route non-execute_actions request to action path", () => {
    const request: EffectRequest = {
      kind: "run_review",
      payload: {}
    };

    const result = executeEffectRequest(request);

    expect(result).toBeDefined();
    expect(result?.kind).toBe("review_result");
    expect(result?.success).toBe(true);
    expect(result?.context).toEqual({ handled: true });
  });

  it("returns undefined for undefined input and invalid result shape for invalid request", () => {
    expect(executeEffectRequest(undefined)).toBeUndefined();

    const invalidRequest = {
      kind: "unknown_kind",
      payload: {}
    } as unknown as EffectRequest;

    const result = executeEffectRequest(invalidRequest);

    expect(result).toBeDefined();
    expect(result?.kind).toBe("action_results");
    expect(result?.success).toBe(false);
    expect(result?.payload).toMatchObject({
      reason: "invalid_effect_request",
      requestKind: "unknown"
    });
  });
});
