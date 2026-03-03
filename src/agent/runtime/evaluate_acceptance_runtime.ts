import { evaluateAcceptance, type EvaluationResult } from "../core/acceptance/engine.js";
import type { EvidenceEvent } from "../core/evidence/types.js";
import type { Intent } from "../core/acceptance/intent.js";
import type { WorkspaceSnapshot } from "../core/workspace/snapshot.js";
import type { ToolRunContext } from "../tools/types.js";
import type { AgentState } from "../types.js";
import { getRuntimePaths } from "./get_runtime_paths.js";

export const evaluateAcceptanceRuntime = (args: {
  goal: string;
  intent: Intent;
  ctx: ToolRunContext;
  state: AgentState;
  evidence: EvidenceEvent[];
  snapshot: WorkspaceSnapshot;
}): EvaluationResult => {
  const runtime = getRuntimePaths(args.ctx, args.state);
  return evaluateAcceptance({
    goal: args.goal,
    intent: args.intent,
    evidence: args.evidence,
    snapshot: args.snapshot,
    runtime
  });
};
