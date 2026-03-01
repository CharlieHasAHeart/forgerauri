import type { AgentState } from "../types.js";
import type { ToolRunContext } from "../tools/types.js";

export const preflightRuntime = (args: { state: AgentState; ctx: ToolRunContext }): void => {
  const { state, ctx } = args;

  if (!ctx.memory.patchPaths) ctx.memory.patchPaths = [];

  if (!state.appDir) {
    if (state.projectRoot) state.appDir = state.projectRoot;
    else if (state.outDir) state.appDir = state.outDir;
  }
};
