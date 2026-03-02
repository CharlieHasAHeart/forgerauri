import { z } from "zod";
import type { LlmProvider } from "../../llm/provider.js";
import type { AgentPolicy } from "../policy/policy.js";
import type { PlanChangeRequestV2, PlanV1, SuccessCriteria } from "../plan/schema.js";
import { planChangeRequestV2Schema, planV1Schema } from "../plan/schema.js";
import { llmJson } from "./json_extract.js";
import { DEFAULT_PLAN_CHANGE_INSTRUCTIONS, DEFAULT_PLAN_INSTRUCTIONS } from "./prompts.js";
import { renderToolIndex } from "./tool_index.js";
import type { ToolSpec } from "../tools/types.js";

const successCriteriaCommandSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["command"] },
    cmd: { type: "string" },
    args: { type: "array", items: { type: "string" } },
    cwd: { type: "string" },
    expect_exit_code: { type: "integer" }
  },
  required: ["type", "cmd"]
};

const successCriteriaFileExistsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["file_exists"] },
    path: { type: "string" }
  },
  required: ["type", "path"]
};

const successCriteriaFileContainsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["file_contains"] },
    path: { type: "string" },
    contains: { type: "string" }
  },
  required: ["type", "path", "contains"]
};

const successCriteriaToolResultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["tool_result"] },
    tool_name: { type: "string" },
    expected_ok: { type: "boolean" }
  },
  required: ["type", "tool_name"]
};

const emitPlanV1Parameters: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", enum: ["v1"] },
    goal: { type: "string" },
    acceptance_locked: { type: "boolean" },
    tech_stack_locked: { type: "boolean" },
    milestones: {
      type: "array",
      minItems: 0,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          task_ids: { type: "array", items: { type: "string" } }
        },
        required: ["id", "title", "task_ids"]
      }
    },
    tasks: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          dependencies: { type: "array", items: { type: "string" } },
          tool_hints: { type: "array", items: { type: "string" } },
          success_criteria: {
            type: "array",
            minItems: 1,
            items: {
              oneOf: [
                successCriteriaCommandSchema,
                successCriteriaFileExistsSchema,
                successCriteriaFileContainsSchema,
                successCriteriaToolResultSchema
              ]
            }
          },
          task_type: {
            type: "string",
            enum: ["build", "codegen", "test", "debug", "verify", "repair", "design", "materialize", "other"]
          }
        },
        required: ["id", "title", "description", "dependencies", "tool_hints", "success_criteria"]
      }
    }
  },
  required: ["version", "goal", "tasks"]
};

const summarizeIssues = (error: z.ZodError): string =>
  error.issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");

const parseMaybeJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (
    !(trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("\"") || trimmed === "true" || trimmed === "false")
  ) {
    return value;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
};

const normalizePlanCandidate = (candidate: unknown): unknown => {
  const parsedCandidate = parseMaybeJson(candidate);
  if (!parsedCandidate || typeof parsedCandidate !== "object" || Array.isArray(parsedCandidate)) {
    return parsedCandidate;
  }

  const out: Record<string, unknown> = { ...(parsedCandidate as Record<string, unknown>) };
  out.acceptance_locked = parseMaybeJson(out.acceptance_locked);
  out.tech_stack_locked = parseMaybeJson(out.tech_stack_locked);
  out.milestones = parseMaybeJson(out.milestones);
  out.tasks = parseMaybeJson(out.tasks);
  return out;
};

const planPromptContent = (args: {
  goal: string;
  policy: AgentPolicy;
  registry: Record<string, ToolSpec>;
  stateSummary: unknown;
  maxToolCallsPerTurn: number;
}): string => {
  const toolIndex = renderToolIndex(args.registry);
  const suggestedRoute = [
    "1) bootstrap workspace with tool_bootstrap_project",
    "2) design contracts with tool_design_contract",
    "3) design UX with tool_design_ux",
    "4) design implementation with tool_design_implementation",
    "5) design delivery with tool_design_delivery",
    "6) materialize contract/ux/implementation/delivery with corresponding tool_materialize_* tools",
    "7) validate design consistency with tool_validate_design",
    "8) deterministic codegen with tool_codegen_from_design",
    "9) verify with tool_verify_project, then repair via tool_repair_known_issues / tool_repair_once only if verify fails"
  ].join("\n");
  return (
    `Create PlanV1 for this goal:\n${args.goal}\n\n` +
    `Tech stack constraints (locked unless user allows):\n${JSON.stringify(args.policy, null, 2)}\n\n` +
    `Tool index:\n${toolIndex}\n\n` +
    `Repo state summary:\n${JSON.stringify(args.stateSummary, null, 2)}\n\n` +
    `Suggested default route (guidance only, adapt when evidence requires):\n${suggestedRoute}\n\n` +
    `Planning constraints:\n${JSON.stringify(
      {
        maxSteps: args.policy.budgets.max_steps,
        maxToolCallsPerTurn: args.maxToolCallsPerTurn,
        acceptanceLocked: args.policy.acceptance.locked,
        techStackLocked: args.policy.tech_stack_locked
      },
      null,
      2
    )}\n` +
    "Every task must include success_criteria with machine-checkable command/file checks."
  );
};

const normalizePlanForExecution = (plan: PlanV1): PlanV1 => {
  const tasks = plan.tasks.map((task) => {
    const hasDesignContractHint = task.tool_hints.includes("tool_design_contract");
    if (!hasDesignContractHint) {
      return task;
    }

    const hasDesignContractToolResult = task.success_criteria.some(
      (criterion) => criterion.type === "tool_result" && criterion.tool_name === "tool_design_contract"
    );
    if (hasDesignContractToolResult) {
      return task;
    }

    const filteredCriteria = task.success_criteria.filter(
      (criterion) => criterion.type !== "file_exists" && criterion.type !== "file_contains"
    );
    const compatibleCriteria: SuccessCriteria[] = [
      { type: "tool_result", tool_name: "tool_design_contract", expected_ok: true },
      ...filteredCriteria
    ];

    return {
      ...task,
      success_criteria: compatibleCriteria
    };
  });

  return {
    ...plan,
    tasks
  };
};

const proposePlanViaToolCall = async (args: {
  goal: string;
  provider: LlmProvider;
  registry: Record<string, ToolSpec>;
  stateSummary: unknown;
  policy: AgentPolicy;
  maxToolCallsPerTurn: number;
  previousResponseId?: string;
  instructions: string;
  truncation?: "auto" | "disabled";
  contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
}): Promise<{
  plan: PlanV1;
  raw: string;
  responseId?: string;
  usage?: unknown;
  previousResponseIdSent?: string;
}> => {
  if (typeof args.provider.completeToolCalls !== "function") {
    throw new Error("provider does not support completeToolCalls");
  }

  const tool = {
    name: "emit_plan_v1",
    description: "Return a PlanV1 JSON object as function arguments (must match schema exactly).",
    inputJsonSchema: emitPlanV1Parameters
  };

  let lastRaw = "";
  let lastUsage: unknown;
  let previousResponseIdSent: string | undefined;
  let messages = [
    {
      role: "user" as const,
      content:
        `${planPromptContent(args)}\n\n` +
        "You MUST call function emit_plan_v1 exactly once.\n" +
        "Task ids must be strings like 't1_setup', not numbers.\n" +
        "success_criteria must be an array (even with one item).\n" +
        "Return no extra text; only the function call arguments."
    }
  ];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const sentPreviousResponseId = undefined;
    const result = await args.provider.completeToolCalls(messages, [tool], {
      temperature: 0,
      maxOutputTokens: 4500,
      enableThinking: false,
      instructions: args.instructions,
      previousResponseId: sentPreviousResponseId,
      truncation: args.truncation,
      contextManagement: args.contextManagement,
      metadata: {
        tool_choice: "required"
      }
    });

    previousResponseIdSent = result.previousResponseIdSent ?? sentPreviousResponseId;
    lastUsage = result.usage;
    lastRaw = result.raw ?? result.text ?? "";

    const calls = result.toolCalls ?? [];
    const planCall = calls.find((call) => call?.name === "emit_plan_v1");
    if (!planCall) {
      // DashScope may return a failed response id that cannot be resumed.
      if (attempt === 3) {
        throw new Error(
          `emit_plan_v1 was not called after retries. lastRaw=${lastRaw.slice(0, 800)} usage=${JSON.stringify(
            lastUsage
          )} previousResponseIdSent=${previousResponseIdSent ?? ""}`
        );
      }

      messages = [
        ...messages,
        {
          role: "user",
          content:
            "You did not call function emit_plan_v1. " +
            "You MUST call emit_plan_v1 exactly once and provide PlanV1 as its arguments. " +
            "Return no extra text."
        }
      ];
      continue;
    }

    const candidate = normalizePlanCandidate(planCall.input);
    if (!candidate || typeof candidate !== "object") {
      if (attempt === 3) {
        throw new Error(
          `emit_plan_v1 arguments missing after retries. lastRaw=${lastRaw.slice(0, 800)} usage=${JSON.stringify(
            lastUsage
          )} previousResponseIdSent=${previousResponseIdSent ?? ""}`
        );
      }

      messages = [
        ...messages,
        {
          role: "user",
          content:
            "emit_plan_v1 arguments were missing or invalid. " +
            "You MUST call emit_plan_v1 exactly once and provide PlanV1 as its arguments. " +
            "Return no extra text."
        }
      ];
      continue;
    }
    try {
      const plan = planV1Schema.parse(candidate);
      return {
        plan: normalizePlanForExecution(plan),
        raw: lastRaw || JSON.stringify(candidate, null, 2),
        responseId: result.responseId,
        usage: result.usage,
        previousResponseIdSent
      };
    } catch (error) {
      if (!(error instanceof z.ZodError) || attempt === 3) {
        throw error;
      }

      messages = [
        ...messages,
        {
          role: "user",
          content:
            "Your emit_plan_v1 arguments did not match PlanV1 schema. " +
            "Fix ONLY the JSON. Do not quote booleans, arrays, or objects. " +
            "Top-level fields acceptance_locked/tech_stack_locked must be booleans; milestones/tasks must be arrays, not strings. " +
            `Errors: ${summarizeIssues(error)}`
        }
      ];
    }
  }

  throw new Error(
    `Failed to produce valid PlanV1 from tool-calling after retries. lastRaw=${lastRaw.slice(0, 800)} usage=${JSON.stringify(
      lastUsage
    )} previousResponseIdSent=${previousResponseIdSent ?? ""}`
  );
};

export const proposePlan = async (args: {
  goal: string;
  provider: LlmProvider;
  registry: Record<string, ToolSpec>;
  stateSummary: unknown;
  policy: AgentPolicy;
  maxToolCallsPerTurn: number;
  previousResponseId?: string;
  instructions?: string;
  truncation?: "auto" | "disabled";
  contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
}): Promise<{
  plan: PlanV1;
  raw: string;
  responseId?: string;
  usage?: unknown;
  previousResponseIdSent?: string;
}> => {
  const instructions = args.instructions ?? DEFAULT_PLAN_INSTRUCTIONS;
  if (args.provider.name === "dashscope_responses" && typeof args.provider.completeToolCalls === "function") {
    return proposePlanViaToolCall({
      ...args,
      instructions
    });
  }

  const result = await llmJson({
    provider: args.provider,
    schema: planV1Schema,
    instructions,
    previousResponseId: args.previousResponseId,
    truncation: args.truncation,
    contextManagement: args.contextManagement,
    maxOutputTokens: 4500,
    messages: [
      {
        role: "user",
        content: planPromptContent(args)
      }
    ]
  });

  return {
    plan: normalizePlanForExecution(result.data),
    raw: result.raw,
    responseId: result.responseId,
    usage: result.usage,
    previousResponseIdSent: result.previousResponseIdSent
  };
};

export const proposePlanChange = async (args: {
  provider: LlmProvider;
  goal: string;
  currentPlan: PlanV1;
  policy: AgentPolicy;
  stateSummary: unknown;
  failureEvidence: string[];
  previousResponseId?: string;
  instructions?: string;
  truncation?: "auto" | "disabled";
  contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
}): Promise<{
  changeRequest: PlanChangeRequestV2;
  raw: string;
  responseId?: string;
  usage?: unknown;
  previousResponseIdSent?: string;
}> => {
  const instructions = args.instructions ?? DEFAULT_PLAN_CHANGE_INSTRUCTIONS;
  const baseMessages = [
    {
      role: "user" as const,
      content:
        `Goal:\n${args.goal}\n\n` +
        `Current plan:\n${JSON.stringify(args.currentPlan, null, 2)}\n\n` +
        `Policy:\n${JSON.stringify(args.policy, null, 2)}\n\n` +
        `Failure evidence:\n${JSON.stringify(args.failureEvidence, null, 2)}\n\n` +
        `State summary:\n${JSON.stringify(args.stateSummary, null, 2)}\n` +
        "Return PlanChangeRequestV2 JSON only."
    }
  ];

  let messages = [...baseMessages];
  let lastError: unknown = undefined;
  let lastResponseId: string | undefined = args.previousResponseId;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await llmJson({
        provider: args.provider,
        schema: planChangeRequestV2Schema,
        instructions,
        previousResponseId: lastResponseId,
        truncation: args.truncation,
        contextManagement: args.contextManagement,
        messages
      });

      return {
        changeRequest: result.data,
        raw: result.raw,
        responseId: result.responseId,
        usage: result.usage,
        previousResponseIdSent: result.previousResponseIdSent
      };
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;

      messages = [
        ...messages,
        {
          role: "user" as const,
          content:
            "Your output did not match PlanChangeRequestV2. " +
            "Fix ONLY the JSON. Required fields: version='v2', reason:string, change_type(enum), impact:{steps_delta:number,risk:string}, patch:array. " +
            `Last error: ${error instanceof Error ? error.message : String(error)}`
        }
      ];
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to produce valid PlanChangeRequestV2 after retries");
};
