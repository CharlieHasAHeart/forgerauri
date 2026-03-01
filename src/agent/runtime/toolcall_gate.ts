import type { FailureSignal } from "./failures.js";
import { fingerprintFailure } from "./failures.js";

export type ToolCall = { name: string; input: unknown };

export type ToolCallGateResult =
  | { ok: true; toolCalls: ToolCall[] }
  | { ok: false; signal: FailureSignal; details: string };

export const gateToolCalls = (args: {
  toolCalls: ToolCall[];
  maxToolCallsPerTurn: number;
  policyMaxActionsPerTask: number;
}): ToolCallGateResult => {
  const limit = Math.min(args.maxToolCallsPerTurn, args.policyMaxActionsPerTask);
  const sliced = (args.toolCalls ?? []).slice(0, limit);

  for (let i = 0; i < sliced.length; i += 1) {
    const call = sliced[i] as any;
    if (!call || typeof call !== "object") {
      const details = `PlannerOutputInvalid: toolCalls[${i}] is not an object`;
      return {
        ok: false,
        details,
        signal: {
          class: "system",
          kind: "PlannerOutputInvalid",
          message: details,
          fingerprint: fingerprintFailure("PlannerOutputInvalid", details)
        }
      };
    }
    if (typeof call.name !== "string" || call.name.trim().length === 0) {
      const details = `PlannerOutputInvalid: toolCalls[${i}].name is missing/empty`;
      return {
        ok: false,
        details,
        signal: {
          class: "system",
          kind: "PlannerOutputInvalid",
          message: details,
          fingerprint: fingerprintFailure("PlannerOutputInvalid", details)
        }
      };
    }
    if (call.input === undefined) {
      const details = `PlannerOutputInvalid: toolCalls[${i}].input is undefined for tool '${call.name}'`;
      return {
        ok: false,
        details,
        signal: {
          class: "system",
          kind: "PlannerOutputInvalid",
          message: details,
          fingerprint: fingerprintFailure("PlannerOutputInvalid", details)
        }
      };
    }
  }

  return { ok: true, toolCalls: sliced };
};
