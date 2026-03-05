import type { AgentState } from "./state.js";
import type { ToolResult, ToolRunContext } from "./tools.js";

export type KernelHooks = {
  onBeforeToolCall?: (args: {
    call: { name: string; input: unknown };
    ctx: ToolRunContext;
    state: AgentState;
  }) => Promise<
    | { action: "allow" }
    | { action: "deny"; error: { code: string; message: string } }
    | { action: "override_call"; call: { name: string; input: unknown } }
    | { action: "override_result"; result: ToolResult }
  >;
  onToolResult?: (args: {
    call: { name: string; input: unknown };
    result: ToolResult;
    ctx: ToolRunContext;
    state: AgentState;
  }) => void | Promise<void>;
  onPatchPathsChanged?: (args: {
    patchPaths: string[];
    ctx: ToolRunContext;
    state: AgentState;
  }) => void | Promise<void>;
};
