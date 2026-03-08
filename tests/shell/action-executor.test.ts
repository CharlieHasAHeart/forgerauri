import { describe, expect, it } from "vitest";
import { type Action } from "../../src/protocol/index.ts";
import {
  canExecuteAction,
  canExecuteActions,
  executeAction,
  executeActions
} from "../../src/shell/action-executor.ts";
import {
  buildActionResult,
  canBuildActionResult
} from "../../src/shell/build-action-result.ts";

describe("action-executor", () => {
  it("returns stable result for executeAction(undefined)", () => {
    const result = executeAction(undefined);

    expect(result).toMatchObject({
      actionId: "unknown-action",
      kind: "unknown",
      success: false,
      payload: {
        accepted: false,
        reason: "invalid_action"
      },
      context: {
        handled: false
      }
    });
  });

  it("returns result consistent with buildActionResult for valid action", () => {
    const action: Action = { kind: "tool", name: "run_tests" };

    const result = executeAction(action);

    expect(result).toEqual(buildActionResult(action));
    expect(result).toMatchObject({
      kind: "tool",
      success: true,
      payload: { accepted: true },
      context: { handled: true }
    });
  });

  it("returns empty array for executeActions([])", () => {
    const results = executeActions([]);

    expect(Array.isArray(results)).toBe(true);
    expect(results).toEqual([]);
  });

  it("maps each valid action to one ActionResult", () => {
    const actions: Action[] = [
      { kind: "tool", name: "lint" },
      { kind: "command", name: "test" }
    ];

    const results = executeActions(actions);

    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(actions.length);
    expect(results).toEqual(actions.map((action) => buildActionResult(action)));
  });

  it("returns false for canExecuteAction(undefined)", () => {
    expect(canExecuteAction(undefined)).toBe(false);
  });

  it("returns true for valid action and matches canBuildActionResult", () => {
    const action: Action = { kind: "review", name: "check_result" };

    expect(canExecuteAction(action)).toBe(true);
    expect(canExecuteAction(action)).toBe(canBuildActionResult(action));
  });

  it("returns current implementation behavior for canExecuteActions([])", () => {
    expect(canExecuteActions([])).toBe(true);
  });

  it("returns true for canExecuteActions with all valid actions", () => {
    const actions: Action[] = [
      { kind: "tool", name: "lint" },
      { kind: "system", name: "sync_state" }
    ];

    expect(canExecuteActions(actions)).toBe(true);
  });

  it("returns false for canExecuteActions with mixed valid and invalid actions", () => {
    const mixed = [
      { kind: "tool", name: "lint" },
      { kind: "tool" }
    ] as unknown as Action[];

    expect(canExecuteActions(mixed)).toBe(false);
  });
});
