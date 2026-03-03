import type { Middleware } from "../compose.js";
import type { ToolCallContext, ToolCallResult } from "./types.js";
import { setStateError } from "../../../core/agent/errors.js";

const fail = (toolName: string, note: string): ToolCallResult => ({
  ok: false,
  note,
  touchedPaths: [],
  toolName
});

export const policyMiddleware: Middleware<ToolCallContext, ToolCallResult> = async (context, next) => {
  if (!context.policy.safety.allowed_tools.includes(context.call.name)) {
    const note = `tool ${context.call.name} is blocked by policy`;
    setStateError(context.state, "Config", note);
    return fail(context.call.name, note);
  }

  const tool = context.registry[context.call.name] as typeof context.tool | undefined;
  if (!tool) {
    const note = `unknown tool ${context.call.name}`;
    setStateError(context.state, "Unknown", note);
    return fail(context.call.name, note);
  }
  context.tool = tool;
  return next(context);
};
