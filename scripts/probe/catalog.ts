export type ProbeCaseKind = "acceptability" | "behavioral";

export type ProbeCase = {
  name: string;
  kind: ProbeCaseKind;
  category: string;
  description: string;
  makeBody?: (ctx: { model: string; baseBody: Record<string, unknown> }) => Record<string, unknown>;
  expectedSignal?: string;
};

const fnTool = {
  type: "function",
  name: "get_weather",
  description: "Get weather by city",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string" }
    },
    required: ["city"],
    additionalProperties: false
  },
  strict: true
};

export const acceptabilityCatalog: ProbeCase[] = [
  {
    name: "model",
    kind: "acceptability",
    category: "core",
    description: "baseline model field",
    makeBody: ({ model }) => ({ model, input: "ping" })
  },
  {
    name: "background",
    kind: "acceptability",
    category: "execution",
    description: "background execution switch",
    makeBody: ({ model }) => ({ model, input: "ping", background: true })
  },
  {
    name: "instructions_acceptability",
    kind: "acceptability",
    category: "instructions",
    description: "instructions field accepted",
    makeBody: ({ model }) => ({ model, input: "ping", instructions: "请只回答 pong" })
  },
  {
    name: "input_string",
    kind: "acceptability",
    category: "input",
    description: "input as plain string",
    makeBody: ({ model }) => ({ model, input: "ping" })
  },
  {
    name: "input_message_array_easy",
    kind: "acceptability",
    category: "input",
    description: "input as message array with string content",
    makeBody: ({ model }) => ({ model, input: [{ type: "message", role: "user", content: "ping" }] })
  },
  {
    name: "conversation",
    kind: "acceptability",
    category: "conversation",
    description: "conversation id envelope",
    makeBody: ({ model }) => ({ model, input: "ping", conversation: { id: "conv_probe_dummy" } })
  },
  {
    name: "input_message_array_content_list",
    kind: "acceptability",
    category: "input",
    description: "input as message array with input_text content list",
    makeBody: ({ model }) => ({
      model,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "ping" }] }]
    })
  },
  {
    name: "temperature",
    kind: "acceptability",
    category: "sampling",
    description: "temperature field",
    makeBody: ({ model }) => ({ model, input: "ping", temperature: 0.2 })
  },
  {
    name: "top_p",
    kind: "acceptability",
    category: "sampling",
    description: "top_p field",
    makeBody: ({ model }) => ({ model, input: "ping", top_p: 0.9 })
  },
  {
    name: "max_output_tokens",
    kind: "acceptability",
    category: "sampling",
    description: "max_output_tokens field",
    makeBody: ({ model }) => ({ model, input: "ping", max_output_tokens: 64 })
  },
  {
    name: "previous_response_id_acceptability",
    kind: "acceptability",
    category: "conversation",
    description: "previous_response_id accepted format",
    makeBody: ({ model }) => ({ model, input: "ping", previous_response_id: "resp_probe_dummy" })
  },
  {
    name: "store",
    kind: "acceptability",
    category: "lifecycle",
    description: "store field",
    makeBody: ({ model }) => ({ model, input: "ping", store: false })
  },
  {
    name: "metadata",
    kind: "acceptability",
    category: "metadata",
    description: "metadata key-value",
    makeBody: ({ model }) => ({ model, input: "ping", metadata: { probe: "true", version: "1" } })
  },
  {
    name: "prompt",
    kind: "acceptability",
    category: "prompt",
    description: "prompt object accepted",
    makeBody: ({ model }) => ({ model, input: "ping", prompt: { id: "pmpt_probe_dummy", version: "1" } })
  },
  {
    name: "prompt_cache_key",
    kind: "acceptability",
    category: "cache",
    description: "prompt_cache_key field",
    makeBody: ({ model }) => ({ model, input: "ping", prompt_cache_key: "probe-key-1" })
  },
  {
    name: "prompt_cache_retention",
    kind: "acceptability",
    category: "cache",
    description: "prompt_cache_retention field",
    makeBody: ({ model }) => ({ model, input: "ping", prompt_cache_retention: "24h" })
  },
  {
    name: "safety_identifier",
    kind: "acceptability",
    category: "safety",
    description: "safety_identifier field",
    makeBody: ({ model }) => ({ model, input: "ping", safety_identifier: "probe-user" })
  },
  {
    name: "user",
    kind: "acceptability",
    category: "legacy",
    description: "user field",
    makeBody: ({ model }) => ({ model, input: "ping", user: "probe-user" })
  },
  {
    name: "include_logprobs",
    kind: "acceptability",
    category: "include",
    description: "include message.output_text.logprobs",
    makeBody: ({ model }) => ({ model, input: "ping", include: ["message.output_text.logprobs"] })
  },
  {
    name: "include_reasoning_encrypted_content",
    kind: "acceptability",
    category: "include",
    description: "include reasoning.encrypted_content",
    makeBody: ({ model }) => ({ model, input: "ping", include: ["reasoning.encrypted_content"] })
  },
  {
    name: "include_web_search_sources",
    kind: "acceptability",
    category: "include",
    description: "include web_search_call.action.sources",
    makeBody: ({ model }) => ({ model, input: "ping", include: ["web_search_call.action.sources"] })
  },
  {
    name: "include_file_search_results",
    kind: "acceptability",
    category: "include",
    description: "include file_search_call.results",
    makeBody: ({ model }) => ({ model, input: "ping", include: ["file_search_call.results"] })
  },
  {
    name: "stream_true",
    kind: "acceptability",
    category: "streaming",
    description: "stream true",
    makeBody: ({ model }) => ({ model, input: "ping", stream: true })
  },
  {
    name: "stream_false",
    kind: "acceptability",
    category: "streaming",
    description: "stream false",
    makeBody: ({ model }) => ({ model, input: "ping", stream: false })
  },
  {
    name: "stream_options",
    kind: "acceptability",
    category: "streaming",
    description: "stream_options.include_obfuscation",
    makeBody: ({ model }) => ({ model, input: "ping", stream: true, stream_options: { include_obfuscation: false } })
  },
  {
    name: "truncation_auto",
    kind: "acceptability",
    category: "context",
    description: "truncation auto",
    makeBody: ({ model }) => ({ model, input: "ping", truncation: "auto" })
  },
  {
    name: "truncation_disabled",
    kind: "acceptability",
    category: "context",
    description: "truncation disabled",
    makeBody: ({ model }) => ({ model, input: "ping", truncation: "disabled" })
  },
  {
    name: "context_management_compaction",
    kind: "acceptability",
    category: "context",
    description: "context_management compaction",
    makeBody: ({ model }) => ({ model, input: "ping", context_management: [{ type: "compaction", compact_threshold: 2000 }] })
  },
  {
    name: "text_format_text",
    kind: "acceptability",
    category: "text_format",
    description: "text.format text",
    makeBody: ({ model }) => ({ model, input: "ping", text: { format: { type: "text" } } })
  },
  {
    name: "text_format_json_object",
    kind: "acceptability",
    category: "text_format",
    description: "text.format json_object",
    makeBody: ({ model }) => ({ model, input: "输出合法 JSON 对象：{\"a\":1}", text: { format: { type: "json_object" } } })
  },
  {
    name: "text_format_json_schema",
    kind: "acceptability",
    category: "text_format",
    description: "text.format json_schema",
    makeBody: ({ model }) => ({
      model,
      input: "输出符合 schema 的 JSON，a=1",
      text: {
        format: {
          type: "json_schema",
          name: "probe",
          strict: true,
          schema: {
            type: "object",
            properties: { a: { type: "number" } },
            required: ["a"],
            additionalProperties: false
          }
        }
      }
    })
  },
  {
    name: "tools_function",
    kind: "acceptability",
    category: "tools",
    description: "function tool",
    makeBody: ({ model }) => ({ model, input: "调用 get_weather，city=Beijing", tools: [fnTool], tool_choice: "required" })
  },
  {
    name: "tool_choice_none",
    kind: "acceptability",
    category: "tools",
    description: "tool_choice none",
    makeBody: ({ model }) => ({ model, input: "ping", tools: [fnTool], tool_choice: "none" })
  },
  {
    name: "tool_choice_auto",
    kind: "acceptability",
    category: "tools",
    description: "tool_choice auto",
    makeBody: ({ model }) => ({ model, input: "ping", tools: [fnTool], tool_choice: "auto" })
  },
  {
    name: "tool_choice_required",
    kind: "acceptability",
    category: "tools",
    description: "tool_choice required",
    makeBody: ({ model }) => ({ model, input: "调用 get_weather，city=Beijing", tools: [fnTool], tool_choice: "required" })
  },
  {
    name: "tools_builtin_web_search",
    kind: "acceptability",
    category: "tools",
    description: "built-in web_search",
    makeBody: ({ model }) => ({ model, input: "使用工具回答今天的科技新闻", tools: [{ type: "web_search" }], tool_choice: "required" })
  },
  {
    name: "tools_builtin_web_extractor",
    kind: "acceptability",
    category: "tools",
    description: "built-in web_extractor",
    makeBody: ({ model }) => ({ model, input: "使用工具提取网页要点", tools: [{ type: "web_extractor" }], tool_choice: "required" })
  },
  {
    name: "tools_builtin_code_interpreter",
    kind: "acceptability",
    category: "tools",
    description: "built-in code_interpreter",
    makeBody: ({ model }) => ({ model, input: "使用工具计算 1+2", tools: [{ type: "code_interpreter" }], tool_choice: "required" })
  },
  {
    name: "parallel_tool_calls",
    kind: "acceptability",
    category: "tools",
    description: "parallel_tool_calls",
    makeBody: ({ model }) => ({ model, input: "ping", tools: [fnTool], parallel_tool_calls: true })
  },
  {
    name: "max_tool_calls",
    kind: "acceptability",
    category: "tools",
    description: "max_tool_calls",
    makeBody: ({ model }) => ({ model, input: "ping", tools: [fnTool], max_tool_calls: 1 })
  },
  {
    name: "enable_thinking_true",
    kind: "acceptability",
    category: "thinking",
    description: "enable_thinking true",
    makeBody: ({ model }) => ({ model, input: "解释二分查找", enable_thinking: true })
  },
  {
    name: "service_tier",
    kind: "acceptability",
    category: "service",
    description: "service_tier field",
    makeBody: ({ model }) => ({ model, input: "ping", service_tier: "default" })
  },
  {
    name: "reasoning",
    kind: "acceptability",
    category: "reasoning",
    description: "reasoning field",
    makeBody: ({ model }) => ({ model, input: "解释二分查找", reasoning: { effort: "medium" } })
  },
  {
    name: "top_logprobs",
    kind: "acceptability",
    category: "sampling",
    description: "top_logprobs field",
    makeBody: ({ model }) => ({ model, input: "ping", top_logprobs: 5 })
  }
];

export const behavioralCatalog: ProbeCase[] = [
  {
    name: "instructions_behavior",
    kind: "behavioral",
    category: "instructions",
    description: "instructions behavior with control group",
    expectedSignal: "instruction output override"
  },
  {
    name: "previous_response_id_behavior",
    kind: "behavioral",
    category: "conversation",
    description: "previous_response_id memory follow-up",
    expectedSignal: "follow-up recalls 7"
  },
  {
    name: "text_format_json_schema_behavior",
    kind: "behavioral",
    category: "text_format",
    description: "json_schema strict behavior",
    expectedSignal: "response is strict JSON matching schema"
  },
  {
    name: "text_format_json_object_behavior",
    kind: "behavioral",
    category: "text_format",
    description: "json_object behavior",
    expectedSignal: "response JSON.parse as object"
  },
  {
    name: "truncation_behavior",
    kind: "behavioral",
    category: "context",
    description: "truncation auto mitigation",
    expectedSignal: "auto succeeds where plain fails"
  },
  {
    name: "tools_function_call_behavior",
    kind: "behavioral",
    category: "tools",
    description: "required function tool emits function_call",
    expectedSignal: "function_call get_weather observed"
  },
  {
    name: "enable_thinking_behavior",
    kind: "behavioral",
    category: "thinking",
    description: "enable_thinking observable impact",
    expectedSignal: "usage/output differs in thinking=true"
  },
  {
    name: "stream_behavior",
    kind: "behavioral",
    category: "streaming",
    description: "stream/stream_options behavior",
    expectedSignal: "SSE or explicit stream event observed"
  },
  {
    name: "tools_builtin_behavior",
    kind: "behavioral",
    category: "tools",
    description: "built-in tool calls behavior",
    expectedSignal: "built-in tool call item observed"
  },
  {
    name: "context_management_behavior",
    kind: "behavioral",
    category: "context",
    description: "context_management compaction behavior",
    expectedSignal: "compaction marker or clear behavior change"
  }
];
