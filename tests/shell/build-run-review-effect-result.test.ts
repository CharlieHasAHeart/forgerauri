import { describe, expect, it } from "vitest";
import { type EffectRequest } from "../../src/protocol/index.ts";
import { buildRunReviewEffectResult } from "../../src/shell/build-run-review-effect-result.ts";
import { executeEffectRequest } from "../../src/shell/execute-effect-request.ts";

describe("buildRunReviewEffectResult", () => {
  it("returns stable review_result for minimal valid run_review request", () => {
    const request: EffectRequest = {
      kind: "run_review",
      payload: {}
    };

    const result = buildRunReviewEffectResult(request);

    expect(result).toMatchObject({
      kind: "review_result",
      success: true,
      payload: {
        accepted: true,
        requestKind: "run_review"
      },
      context: {
        handled: true
      }
    });
  });

  it("keeps stable result shape when payload contains extra fields", () => {
    const request: EffectRequest = {
      kind: "run_review",
      payload: {
        criteria: { strict: true },
        notes: "ignored by current minimal review builder"
      }
    };

    const result = buildRunReviewEffectResult(request);

    expect(result).toEqual({
      kind: "review_result",
      success: true,
      payload: {
        accepted: true,
        requestKind: "run_review"
      },
      context: {
        handled: true
      }
    });
  });

  it("matches current executeEffectRequest output for run_review path", () => {
    const request: EffectRequest = {
      kind: "run_review",
      payload: {
        evidenceRefs: ["ev-1"]
      }
    };

    const directResult = buildRunReviewEffectResult(request);
    const entryResult = executeEffectRequest(request);

    expect(entryResult).toEqual(directResult);
  });
});
