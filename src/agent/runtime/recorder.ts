// Centralized audit event record helpers for plan/task/replan events.
import type { AgentTurnAuditCollector } from "../../runtime/audit/index.js";

export const recordPlanProposed = (args: {
  audit: AgentTurnAuditCollector;
  llmRaw: string;
  previousResponseIdSent?: string;
  responseId?: string;
  usage?: unknown;
  taskCount: number;
}): void => {
  args.audit.recordTurn({
    turn: 0,
    llmRaw: args.llmRaw,
    llmPreviousResponseId: args.previousResponseIdSent,
    llmResponseId: args.responseId,
    llmUsage: args.usage,
    toolCalls: [],
    toolResults: [],
    note: `initial plan generated: ${args.taskCount} tasks`
  });
};

export const recordTaskActionPlan = (args: {
  audit: AgentTurnAuditCollector;
  turn: number;
  taskId: string;
  llmRaw: string;
  previousResponseIdSent?: string;
  responseId?: string;
  usage?: unknown;
  toolCalls: Array<{ name: string; input: unknown }>;
  toolResults: Array<{ name: string; ok: boolean; error?: string; touchedPaths?: string[] }>;
}): void => {
  args.audit.recordTurn({
    turn: args.turn,
    llmRaw: args.llmRaw,
    llmPreviousResponseId: args.previousResponseIdSent,
    llmResponseId: args.responseId,
    llmUsage: args.usage,
    note: `task_tool_calls for ${args.taskId}`,
    toolCalls: args.toolCalls,
    toolResults: args.toolResults
  });
};

export const recordPlanChange = (args: {
  audit: AgentTurnAuditCollector;
  turn: number;
  llmRaw: string;
  previousResponseIdSent?: string;
  responseId?: string;
  usage?: unknown;
  gateResult: { status: string; reason: string };
}): void => {
  args.audit.recordTurn({
    turn: args.turn,
    llmRaw: args.llmRaw,
    llmPreviousResponseId: args.previousResponseIdSent,
    llmResponseId: args.responseId,
    llmUsage: args.usage,
    note: `plan-change gate ${args.gateResult.status}: ${args.gateResult.reason}`,
    toolCalls: [],
    toolResults: []
  });
};
