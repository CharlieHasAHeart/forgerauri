import type { PlanTask } from "../plan/schema.js";
import { buildCriterionToolCall } from "./criteria.js";

export type ExecutedToolResult = {
  ok: boolean;
  note?: string;
  toolName: string;
};

export const evaluateSuccessCriteriaWithTools = async (args: {
  task: PlanTask;
  toolResults: Array<{ name: string; ok: boolean }>;
  executeToolCall: (call: { name: string; input: unknown }) => Promise<ExecutedToolResult>;
}): Promise<{ ok: boolean; failures: string[]; toolAudit: Array<{ name: string; ok: boolean; error?: string }> }> => {
  const failures: string[] = [];
  const toolAudit: Array<{ name: string; ok: boolean; error?: string }> = [];

  for (const criterion of args.task.success_criteria) {
    if (criterion.type === "tool_result") {
      const result = args.toolResults.find((r) => r.name === criterion.tool_name);
      if (!result || result.ok !== criterion.expected_ok) {
        failures.push(`tool_result failed for ${criterion.tool_name}`);
      }
      continue;
    }

    const checkCall = buildCriterionToolCall(criterion);
    if (!checkCall) continue;

    const executed = await args.executeToolCall(checkCall);
    toolAudit.push({ name: checkCall.name, ok: executed.ok, error: executed.ok ? undefined : executed.note });

    if (!executed.ok) {
      failures.push(`criteria check failed: ${checkCall.name}`);
    }
  }

  return { ok: failures.length === 0, failures, toolAudit };
};
