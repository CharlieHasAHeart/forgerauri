import type { ContextPacket } from "../contracts/context.js";
import { serializeContextPacket } from "../contracts/context.js";
import type { LlmMessage, LlmPort } from "../contracts/llm.js";
import type { Planner, PlanChangeRequestV2, PlanTask, PlanV1, ToolCall } from "../contracts/planning.js";

type ProposalResult<T> = {
  data: T;
  raw: string;
  responseId?: string;
  usage?: unknown;
  previousResponseIdSent?: string;
};

const asObject = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const asString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be non-empty string`);
  return value.trim();
};

const asStringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be string[]`);
  return value.map((item, index) => asString(item, `${label}[${index}]`));
};

const parseToolCall = (value: unknown, index: number): ToolCall => {
  const obj = asObject(value, `toolCalls[${index}]`);
  const name = asString(obj.name, `toolCalls[${index}].name`);
  const onFail = obj.on_fail;
  if (typeof onFail !== "undefined" && onFail !== "stop" && onFail !== "continue") {
    throw new Error(`toolCalls[${index}].on_fail must be 'stop'|'continue'`);
  }
  return {
    name,
    input: typeof obj.input === "undefined" ? {} : obj.input,
    on_fail: onFail as "stop" | "continue" | undefined
  };
};

const parseSuccessCriterion = (value: unknown, label: string): PlanTask["success_criteria"][number] => {
  const obj = asObject(value, label);
  const type = asString(obj.type, `${label}.type`);
  if (type === "tool_result") {
    return {
      type,
      tool_name: asString(obj.tool_name, `${label}.tool_name`),
      expected_ok: typeof obj.expected_ok === "boolean" ? obj.expected_ok : undefined
    };
  }
  if (type === "file_exists") {
    return { type, path: asString(obj.path, `${label}.path`) };
  }
  if (type === "file_contains") {
    return {
      type,
      path: asString(obj.path, `${label}.path`),
      contains: asString(obj.contains, `${label}.contains`)
    };
  }
  if (type === "command") {
    return {
      type,
      cmd: asString(obj.cmd, `${label}.cmd`),
      args: Array.isArray(obj.args) ? asStringArray(obj.args, `${label}.args`) : undefined,
      cwd: typeof obj.cwd === "string" ? obj.cwd : undefined,
      expect_exit_code: typeof obj.expect_exit_code === "number" ? Math.floor(obj.expect_exit_code) : undefined
    };
  }
  throw new Error(`${label}.type unsupported: ${type}`);
};

const parsePlanTask = (value: unknown, index: number): PlanTask => {
  const obj = asObject(value, `tasks[${index}]`);
  const successCriteriaRaw = obj.success_criteria;
  if (!Array.isArray(successCriteriaRaw)) throw new Error(`tasks[${index}].success_criteria must be array`);
  return {
    id: asString(obj.id, `tasks[${index}].id`),
    title: asString(obj.title, `tasks[${index}].title`),
    description: typeof obj.description === "string" ? obj.description : undefined,
    dependencies: Array.isArray(obj.dependencies) ? asStringArray(obj.dependencies, `tasks[${index}].dependencies`) : [],
    success_criteria: successCriteriaRaw.map((item, i) => parseSuccessCriterion(item, `tasks[${index}].success_criteria[${i}]`))
  };
};

const parsePlan = (value: unknown): PlanV1 => {
  const obj = asObject(value, "plan");
  const version = asString(obj.version, "plan.version");
  if (version !== "v1") throw new Error("plan.version must be 'v1'");
  const tasksRaw = obj.tasks;
  if (!Array.isArray(tasksRaw)) throw new Error("plan.tasks must be array");
  return {
    version: "v1",
    goal: typeof obj.goal === "string" && obj.goal.trim() ? obj.goal.trim() : "",
    tasks: tasksRaw.map((item, index) => parsePlanTask(item, index))
  };
};

const parseToolCallsResponse = (value: unknown): { toolCalls: ToolCall[] } => {
  const obj = asObject(value, "toolCalls response");
  const calls = obj.toolCalls;
  if (!Array.isArray(calls)) throw new Error("toolCalls response must include toolCalls[]");
  return { toolCalls: calls.map((item, index) => parseToolCall(item, index)) };
};

const parsePlanChangeRequest = (value: unknown): PlanChangeRequestV2 => {
  const obj = asObject(value, "plan change request");
  const version = asString(obj.version, "change.version");
  if (version !== "v2") throw new Error("change.version must be 'v2'");
  const patch = obj.patch;
  if (!Array.isArray(patch)) throw new Error("change.patch must be array");
  return {
    version: "v2",
    reason: asString(obj.reason, "change.reason"),
    change_type: typeof obj.change_type === "string" ? obj.change_type : "unknown",
    impact: obj.impact && typeof obj.impact === "object" ? (obj.impact as Record<string, unknown>) : undefined,
    patch: patch as PlanChangeRequestV2["patch"]
  };
};

const extractFirstJsonObject = (text: string): unknown => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object found in model output");
  const jsonText = text.slice(start, end + 1);
  return JSON.parse(jsonText);
};

const requestStructured = async <T>(args: {
  provider: LlmPort;
  messages: LlmMessage[];
  schemaHint: string;
  validate: (value: unknown) => T;
}): Promise<ProposalResult<T>> => {
  const enhancedMessages: LlmMessage[] = [
    ...args.messages,
    {
      role: "user",
      content: `Return only JSON matching this shape hint:\n${args.schemaHint}`
    }
  ];

  if (args.provider.completeJSON) {
    const json = await args.provider.completeJSON<unknown>(enhancedMessages, { type: "object" }, { temperature: 0 });
    return {
      data: args.validate(json.data),
      raw: json.raw,
      responseId: json.responseId,
      usage: json.usage,
      previousResponseIdSent: json.previousResponseIdSent
    };
  }

  if (args.provider.complete) {
    const completion = await args.provider.complete(enhancedMessages, { temperature: 0 });
    const parsed = extractFirstJsonObject(completion.text);
    return {
      data: args.validate(parsed),
      raw: completion.text,
      responseId: completion.responseId,
      usage: completion.usage
    };
  }

  throw new Error(`Provider '${args.provider.name}' does not support complete or completeJSON`);
};

const planningMessages = (context: ContextPacket): LlmMessage[] => [
  {
    role: "system",
    content: "You are a deterministic planner. Follow provided context, prefer verification tools when evidence is missing, and output strict JSON only."
  },
  {
    role: "user",
    content: serializeContextPacket(context)
  }
];

export const createDefaultPlanner = (args: { provider: LlmPort }): Planner => ({
  async proposePlan(input) {
    const result = await requestStructured({
      provider: args.provider,
      messages: planningMessages(input.context),
      schemaHint: `{"version":"v1","goal":"string","tasks":[{"id":"string","title":"string","description":"string?","dependencies":["string"],"success_criteria":[{"type":"tool_result|file_exists|file_contains|command", "...":"..."}]}]}`,
      validate: parsePlan
    });
    return {
      plan: result.data,
      raw: result.raw,
      responseId: result.responseId,
      usage: result.usage,
      previousResponseIdSent: result.previousResponseIdSent
    };
  },
  async proposeToolCallsForTask(input) {
    const result = await requestStructured({
      provider: args.provider,
      messages: [
        ...planningMessages(input.context),
        {
          role: "user",
          content: `Task to execute:\n${JSON.stringify(input.task, null, 2)}\nUse tools from the provided registry and policy only.`
        }
      ],
      schemaHint: `{"toolCalls":[{"name":"string","input":{},"on_fail":"stop|continue?"}]}`,
      validate: parseToolCallsResponse
    });
    return {
      toolCalls: result.data.toolCalls,
      raw: result.raw,
      responseId: result.responseId,
      usage: result.usage,
      previousResponseIdSent: result.previousResponseIdSent
    };
  },
  async proposePlanChange(input) {
    const result = await requestStructured({
      provider: args.provider,
      messages: [
        ...planningMessages(input.context),
        {
          role: "user",
          content: `Current plan:\n${JSON.stringify(input.currentPlan, null, 2)}`
        }
      ],
      schemaHint: `{"version":"v2","reason":"string","change_type":"string","impact":{},"patch":[]}`,
      validate: parsePlanChangeRequest
    });
    return {
      changeRequest: result.data,
      raw: result.raw,
      responseId: result.responseId,
      usage: result.usage,
      previousResponseIdSent: result.previousResponseIdSent
    };
  }
});
