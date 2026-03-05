import type { ContextBudget, ContextPacket, Evidence } from "../contracts/context.js";
import type { AgentPolicy } from "../contracts/policy.js";
import type { AgentState } from "../contracts/state.js";
import type { ToolRunContext, ToolSpec } from "../contracts/tools.js";
import type { Workspace } from "../contracts/workspace.js";
import type { PlanTask, PlanV1 } from "../contracts/planning.js";
import { storeBlob } from "../utils/blobStore.js";
import { buildSystemRules } from "./builders/buildSystemRules.js";
import { buildProjectSnapshot } from "./builders/buildProjectSnapshot.js";
import { buildLatestEvidence } from "./builders/buildLatestEvidence.js";
import { buildRelevantCode } from "./builders/buildRelevantCode.js";
import { buildChangesSoFar } from "./builders/buildChangesSoFar.js";
import { injectMemory, type MemoryQuery } from "./builders/injectMemory.js";
import { layoutPacket } from "./builders/layoutPacket.js";

export type ContextPhase = "planning" | "toolcall" | "replan" | "review";

export class ContextEngine {
  private readonly budget: Required<ContextBudget>;
  private readonly memoryQuery?: MemoryQuery;

  constructor(args?: { budget?: ContextBudget; memoryQuery?: MemoryQuery }) {
    this.budget = {
      projectSnapshotChars: args?.budget?.projectSnapshotChars ?? 2500,
      latestEvidenceChars: args?.budget?.latestEvidenceChars ?? 2200,
      relevantCodeChars: args?.budget?.relevantCodeChars ?? 5000,
      changesSoFarChars: args?.budget?.changesSoFarChars ?? 1600,
      memoryChars: args?.budget?.memoryChars ?? 900,
      nextActionChars: args?.budget?.nextActionChars ?? 800
    };
    this.memoryQuery = args?.memoryQuery;
  }

  async buildContextPacket(args: {
    phase: ContextPhase;
    turn: number;
    state: AgentState;
    ctx: ToolRunContext;
    registry: Record<string, ToolSpec<any>>;
    policy: AgentPolicy;
    workspace: Workspace;
    task?: PlanTask;
    plan?: PlanV1;
    failures?: string[];
    evidence?: Evidence;
  }): Promise<ContextPacket> {
    const evidence = args.evidence ?? args.state.lastEvidence ?? args.ctx.memory.verifyEvidence;
    const relevantCode = await buildRelevantCode({
      ctx: args.ctx,
      evidence,
      repoRoot: args.workspace.root,
      maxChars: this.budget.relevantCodeChars
    });

    const memoryDecisions = await injectMemory({
      query: this.memoryQuery,
      evidence,
      taskId: args.task?.id,
      paths: relevantCode.map((item) => item.path)
    });

    const nextActionRequest =
      evidence
        ? `Phase=${args.phase}. Produce deterministic output for the requested phase using provided evidence first.`
        : `Phase=${args.phase}. Evidence is missing. First action MUST call an available verification tool to produce LatestEvidence.`;

    const packet: ContextPacket = {
      systemRules: buildSystemRules(),
      runGoal: args.state.goal,
      projectSnapshot: buildProjectSnapshot({
        state: args.state,
        policy: args.policy,
        workspace: args.workspace,
        registry: args.registry,
        maxChars: this.budget.projectSnapshotChars
      }),
      latestEvidence: buildLatestEvidence({
        evidence,
        maxChars: this.budget.latestEvidenceChars
      }),
      relevantCode,
      changesSoFar: buildChangesSoFar({ state: args.state, maxChars: this.budget.changesSoFarChars }),
      memoryDecisions,
      nextActionRequest
    };

    const rendered = layoutPacket(packet);
    const packetRef = storeBlob(args.ctx, rendered, "context");
    args.state.contextHistory.push({
      turn: args.turn,
      phase: args.phase,
      packetRef
    });

    return packet;
  }
}
