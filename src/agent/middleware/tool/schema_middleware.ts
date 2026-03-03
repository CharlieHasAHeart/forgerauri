import type { Middleware } from "../compose.js";
import type { ToolCallContext, ToolCallResult } from "./types.js";
import { setStateError } from "../../../core/agent/errors.js";

const fail = (toolName: string, note: string): ToolCallResult => ({
  ok: false,
  note,
  touchedPaths: [],
  toolName
});

export const schemaMiddleware: Middleware<ToolCallContext, ToolCallResult> = async (context, next) => {
  if (!context.tool) {
    const note = `schema middleware missing tool for ${context.call.name}`;
    setStateError(context.state, "Unknown", note);
    return fail(context.call.name, note);
  }
  const parsed = context.tool.inputSchema.safeParse(context.call.input);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    setStateError(context.state, "Config", detail);
    return fail(context.call.name, detail);
  }
  context.parsedInput = parsed.data;
  return next(context);
};
