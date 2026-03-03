import type { AgentPolicy } from "../../../core/agent/policy/policy.js";
import type { AgentState } from "../../types.js";
import type { ToolRunContext, ToolSpec, ToolResult } from "../../tools/types.js";
import type { AgentEvent } from "../../../core/agent/events.js";
import type { HumanReviewFn } from "../../../core/agent/contracts.js";

export type ToolCallContext = {
  call: { name: string; input: unknown };
  registry: Record<string, ToolSpec<any>>;
  ctx: ToolRunContext;
  state: AgentState;
  policy: AgentPolicy;
  humanReview?: HumanReviewFn;
  onEvent?: (event: AgentEvent) => void;
  tool?: ToolSpec<any>;
  parsedInput?: unknown;
  toolRunResult?: ToolResult;
  runtimePaths?: { repoRoot: string; appDir: string; tauriDir: string };
  evidenceCallId?: string;
};

export type ToolCallResult = {
  ok: boolean;
  note?: string;
  touchedPaths: string[];
  resultData?: unknown;
  toolName: string;
};
