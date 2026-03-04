import type { AgentState } from "../contracts/state.js";
import type { LlmPort } from "../contracts/llm.js";
import type { KernelHooks } from "../contracts/hooks.js";
import type { ToolRunContext, ToolSpec } from "../contracts/tools.js";

export type KernelMiddleware = {
  name: string;
  init?: (args: { ctx: ToolRunContext; state: AgentState }) => void | Promise<void>;
  tools?: () => Record<string, ToolSpec<any>>;
  wrapProvider?: (provider: LlmPort) => LlmPort;
  hooks?: {
    onToolResult?: KernelHooks["onToolResult"];
    onPatchPathsChanged?: KernelHooks["onPatchPathsChanged"];
  };
};
