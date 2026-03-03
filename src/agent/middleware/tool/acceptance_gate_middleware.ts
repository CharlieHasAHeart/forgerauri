import { join } from "node:path";
import type { Middleware } from "../compose.js";
import type { ToolCallContext, ToolCallResult } from "./types.js";
import { readEvidenceJsonlWithDiagnostics } from "../../core/evidence/reader.js";
import { createSnapshot } from "../../core/workspace/snapshot.js";
import { evaluateAcceptanceRuntime } from "../../../core/agent/evaluate_acceptance_runtime.js";
import { DEFAULT_ACCEPTANCE_PIPELINE_ID } from "../../core/acceptance/catalog.js";

export const acceptanceGateMiddleware: Middleware<ToolCallContext, ToolCallResult> = async (context, next) => {
  const result = await next(context);
  if (context.call.name !== "tool_verify_project" || !result.ok) {
    return result;
  }

  try {
    const evidenceFilePath = join(context.ctx.memory.outDir ?? context.state.outDir, "run_evidence.jsonl");
    const evidenceRead = await readEvidenceJsonlWithDiagnostics(evidenceFilePath);
    const runtimePaths = context.runtimePaths;
    if (!runtimePaths) return result;
    const snapshot = await createSnapshot(runtimePaths.repoRoot, { paths: [] });
    const acceptance = evaluateAcceptanceRuntime({
      goal: context.state.goal,
      intent: { type: "verify_acceptance_pipeline", pipeline_id: DEFAULT_ACCEPTANCE_PIPELINE_ID },
      ctx: context.ctx,
      state: context.state,
      evidence: evidenceRead.events,
      snapshot
    });
    const acceptanceDiagnostics = [
      ...evidenceRead.diagnostics.map((item) => `evidence: ${item}`),
      ...acceptance.diagnostics.map((item) => `acceptance: ${item}`)
    ];
    context.state.lastDeterministicFixes = acceptanceDiagnostics.slice(-20);
    if (acceptance.status !== "satisfied") {
      const message = `VERIFY_ACCEPTANCE_FAILED: pipeline '${DEFAULT_ACCEPTANCE_PIPELINE_ID}' status=${acceptance.status}; ${acceptanceDiagnostics.join(
        " | "
      )}`;
      context.state.lastError = { kind: "Config", code: "VERIFY_ACCEPTANCE_FAILED", message };
      return {
        ...result,
        ok: false,
        note: message
      };
    }
  } catch (error) {
    context.state.lastDeterministicFixes = [
      ...(context.state.lastDeterministicFixes ?? []),
      `acceptance runtime evaluation failed: ${error instanceof Error ? error.message : String(error)}`
    ].slice(-20);
  }
  return result;
};
