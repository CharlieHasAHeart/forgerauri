import { describe, expect, it } from "vitest";
import { type Action, type EffectRequest } from "../../src/protocol/index.ts";
import { buildActionResult } from "../../src/shell/build-action-result.ts";
import {
  areAllActionResultsSuccessful,
  buildActionResultsPayload,
  buildEffectResultFromActionResults,
  buildEffectResultFromActions,
  buildEffectResultFromSingleAction,
  canBuildEffectResultFromActions
} from "../../src/shell/build-effect-result-from-actions.ts";

describe("build-effect-result-from-actions", () => {
  const validRequest: EffectRequest = {
    kind: "execute_actions",
    payload: {}
  };

  it("buildActionResultsPayload returns stable payload structure", () => {
    const action: Action = { kind: "tool", name: "lint" };
    const results = [buildActionResult(action)];

    const payload = buildActionResultsPayload(results);

    expect(payload).toEqual({
      results,
      count: 1
    });
  });

  it("areAllActionResultsSuccessful([]) matches current behavior", () => {
    expect(areAllActionResultsSuccessful([])).toBe(true);
  });

  it("areAllActionResultsSuccessful returns true for all successful results", () => {
    const results = [
      buildActionResult({ kind: "tool", name: "lint" }),
      buildActionResult({ kind: "command", name: "test" })
    ];

    expect(areAllActionResultsSuccessful(results)).toBe(true);
  });

  it("areAllActionResultsSuccessful returns false when any result fails", () => {
    const results = [buildActionResult({ kind: "tool", name: "lint" }), buildActionResult(undefined)];

    expect(areAllActionResultsSuccessful(results)).toBe(false);
  });

  it("buildEffectResultFromActionResults returns normalized EffectResult", () => {
    const results = [buildActionResult({ kind: "tool", name: "lint" }), buildActionResult(undefined)];

    const effectResult = buildEffectResultFromActionResults(validRequest, results);

    expect(effectResult).toMatchObject({
      kind: "action_results",
      success: false,
      context: {
        requestKind: "execute_actions",
        handled: true
      }
    });
    expect(effectResult.payload).toEqual({
      results,
      count: 2
    });
  });

  it("buildEffectResultFromActionResults handles empty results stably", () => {
    const effectResult = buildEffectResultFromActionResults(validRequest, []);

    expect(effectResult).toMatchObject({
      kind: "action_results",
      success: true,
      context: {
        requestKind: "execute_actions",
        handled: true
      }
    });
    expect(effectResult.payload).toEqual({
      results: [],
      count: 0
    });
  });

  it("buildEffectResultFromSingleAction equals single-result aggregation", () => {
    const action: Action = { kind: "tool", name: "lint" };

    const viaSingle = buildEffectResultFromSingleAction(validRequest, action);
    const viaAggregate = buildEffectResultFromActionResults(validRequest, [buildActionResult(action)]);

    expect(viaSingle).toEqual(viaAggregate);
  });

  it("buildEffectResultFromActions matches map(buildActionResult) aggregation", () => {
    const actions: Action[] = [
      { kind: "tool", name: "lint" },
      { kind: "command", name: "test" }
    ];

    const fromActions = buildEffectResultFromActions(validRequest, actions);
    const expected = buildEffectResultFromActionResults(
      validRequest,
      actions.map((action) => buildActionResult(action))
    );

    expect(fromActions).toEqual(expected);
  });

  it("buildEffectResultFromActions(undefined, actions) matches current behavior", () => {
    const actions: Action[] = [{ kind: "tool", name: "lint" }];

    expect(buildEffectResultFromActions(undefined, actions)).toBeUndefined();
  });

  it("canBuildEffectResultFromActions(undefined, actions) returns false", () => {
    const actions: Action[] = [{ kind: "tool", name: "lint" }];

    expect(canBuildEffectResultFromActions(undefined, actions)).toBe(false);
  });

  it("canBuildEffectResultFromActions returns true for valid request and valid actions", () => {
    const actions: Action[] = [
      { kind: "tool", name: "lint" },
      { kind: "system", name: "sync" }
    ];

    expect(canBuildEffectResultFromActions(validRequest, actions)).toBe(true);
  });

  it("canBuildEffectResultFromActions returns false when actions contain invalid items", () => {
    const mixedActions = [
      { kind: "tool", name: "lint" },
      { kind: "tool" }
    ] as unknown as Action[];

    expect(canBuildEffectResultFromActions(validRequest, mixedActions)).toBe(false);
  });

  it("supports defensive aggregation with non-builder results for boundary tolerance", () => {
    const looseResults = [{ success: true }, { success: false }] as unknown[];
    const effectResult = buildEffectResultFromActionResults(
      validRequest,
      looseResults as ReturnType<typeof buildActionResult>[]
    );

    expect(effectResult.kind).toBe("action_results");
    expect(effectResult.success).toBe(false);
    expect(effectResult.context).toEqual({
      requestKind: "execute_actions",
      handled: true
    });
    expect(effectResult.payload).toMatchObject({ count: 2 });
  });
});
