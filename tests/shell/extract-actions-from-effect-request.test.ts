import { describe, expect, it } from "vitest";
import { type Action, type EffectRequest } from "../../src/protocol/index.ts";
import {
  canExtractActionsFromEffectRequest,
  extractActionsFromEffectRequest
} from "../../src/shell/extract-actions-from-effect-request.ts";

describe("extractActionsFromEffectRequest", () => {
  it("returns empty and false for undefined input", () => {
    expect(extractActionsFromEffectRequest(undefined)).toEqual([]);
    expect(canExtractActionsFromEffectRequest(undefined)).toBe(false);
  });

  it("returns empty and false for invalid request object", () => {
    const invalidRequest = { payload: { actions: [] } } as unknown as EffectRequest;

    expect(extractActionsFromEffectRequest(invalidRequest)).toEqual([]);
    expect(canExtractActionsFromEffectRequest(invalidRequest)).toBe(false);
  });

  it("returns empty and false when kind is not execute_actions", () => {
    const request: EffectRequest = {
      kind: "run_review",
      payload: {
        actions: [{ kind: "tool", name: "lint" }]
      }
    };

    expect(extractActionsFromEffectRequest(request)).toEqual([]);
    expect(canExtractActionsFromEffectRequest(request)).toBe(false);
  });

  it("returns empty and false when payload is not an object", () => {
    const nullPayloadRequest = {
      kind: "execute_actions",
      payload: null
    } as unknown as EffectRequest;

    const stringPayloadRequest = {
      kind: "execute_actions",
      payload: "payload"
    } as unknown as EffectRequest;

    const numberPayloadRequest = {
      kind: "execute_actions",
      payload: 1
    } as unknown as EffectRequest;

    expect(extractActionsFromEffectRequest(nullPayloadRequest)).toEqual([]);
    expect(extractActionsFromEffectRequest(stringPayloadRequest)).toEqual([]);
    expect(extractActionsFromEffectRequest(numberPayloadRequest)).toEqual([]);

    expect(canExtractActionsFromEffectRequest(nullPayloadRequest)).toBe(false);
    expect(canExtractActionsFromEffectRequest(stringPayloadRequest)).toBe(false);
    expect(canExtractActionsFromEffectRequest(numberPayloadRequest)).toBe(false);
  });

  it("returns empty and false when payload.actions is not an array", () => {
    const objectActionsRequest: EffectRequest = {
      kind: "execute_actions",
      payload: { actions: { kind: "tool", name: "lint" } }
    };

    const stringActionsRequest: EffectRequest = {
      kind: "execute_actions",
      payload: { actions: "actions" }
    };

    const undefinedActionsRequest: EffectRequest = {
      kind: "execute_actions",
      payload: {}
    };

    expect(extractActionsFromEffectRequest(objectActionsRequest)).toEqual([]);
    expect(extractActionsFromEffectRequest(stringActionsRequest)).toEqual([]);
    expect(extractActionsFromEffectRequest(undefinedActionsRequest)).toEqual([]);

    expect(canExtractActionsFromEffectRequest(objectActionsRequest)).toBe(false);
    expect(canExtractActionsFromEffectRequest(stringActionsRequest)).toBe(false);
    expect(canExtractActionsFromEffectRequest(undefinedActionsRequest)).toBe(false);
  });

  it("returns empty and false when payload.actions is an empty array", () => {
    const request: EffectRequest = {
      kind: "execute_actions",
      payload: { actions: [] }
    };

    expect(extractActionsFromEffectRequest(request)).toEqual([]);
    expect(canExtractActionsFromEffectRequest(request)).toBe(false);
  });

  it("returns all actions and true when payload.actions are all valid", () => {
    const actions: Action[] = [
      { kind: "tool", name: "lint" },
      { kind: "command", name: "test" }
    ];

    const request: EffectRequest = {
      kind: "execute_actions",
      payload: { actions }
    };

    expect(extractActionsFromEffectRequest(request)).toEqual(actions);
    expect(canExtractActionsFromEffectRequest(request)).toBe(true);
  });

  it("filters invalid actions and evaluates canExtract by filtered result", () => {
    const mixedActions = [
      { kind: "tool", name: "lint" },
      { kind: "tool" },
      "invalid"
    ] as unknown as Action[];

    const requestWithMixedActions: EffectRequest = {
      kind: "execute_actions",
      payload: { actions: mixedActions }
    };

    const requestWithOnlyInvalidActions: EffectRequest = {
      kind: "execute_actions",
      payload: {
        actions: [{ kind: "tool" }, { kind: "unknown", name: "x" }]
      }
    } as unknown as EffectRequest;

    expect(extractActionsFromEffectRequest(requestWithMixedActions)).toEqual([
      { kind: "tool", name: "lint" }
    ]);
    expect(canExtractActionsFromEffectRequest(requestWithMixedActions)).toBe(true);

    expect(extractActionsFromEffectRequest(requestWithOnlyInvalidActions)).toEqual([]);
    expect(canExtractActionsFromEffectRequest(requestWithOnlyInvalidActions)).toBe(false);
  });
});
