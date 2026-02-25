import type { z } from "zod";
import type { ToolResult, ToolRunContext, ToolSpec } from "./types.js";

export const summarizeZodIssues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");

export const wrapToolRunWithOutputValidation = (
  tool: ToolSpec<any>,
  run: (input: any, ctx: ToolRunContext) => Promise<ToolResult>
): ((input: any, ctx: ToolRunContext) => Promise<ToolResult>) => {
  return async (input, ctx) => {
    const result = await run(input, ctx);
    if (!result.ok || !tool.outputSchema) return result;

    const parsed = tool.outputSchema.safeParse(result.data);
    if (parsed.success) {
      return {
        ...result,
        data: parsed.data
      };
    }

    return {
      ok: false,
      error: {
        code: "TOOL_OUTPUT_SCHEMA_INVALID",
        message: "Tool output does not match outputSchema",
        detail: summarizeZodIssues(parsed.error)
      },
      meta: {
        touchedPaths: result.meta?.touchedPaths ?? []
      }
    };
  };
};
