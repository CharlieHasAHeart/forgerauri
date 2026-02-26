# Bailian Responses API Compatibility Guide

- Endpoint: `https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1/responses`
- Auth: `Authorization: Bearer <DASHSCOPE_API_KEY>`
- Generated at: 2026-02-26T07:05:31.600Z
- Timeout(ms): 5000
- Repeat: 2

## Status Criteria

- `supported`: accepted (HTTP 200) and behavior signal verified.
- `ignored`: accepted (HTTP 200) but behavior signal not observed.
- `rejected`: invalid/unknown parameter or explicit rejection (typically 4xx).
- `flaky`: repeated runs gave inconsistent status / transient failures.
- `unknown`: accepted but no reliable observable signal.

## Model: `qwen3-max-2026-01-23`

| Field | Category | Kind | Status | Notes |
|---|---|---|---|---|
| context_management_behavior | context | behavioral | unknown | accepted but no explicit compaction signal |
| context_management_compaction | context | acceptability | supported | context_management compaction |
| enable_thinking_behavior | thinking | behavioral | supported | accepted with observable difference |
| enable_thinking_true | thinking | acceptability | flaky | enable_thinking true |
| include_file_search_results | include | acceptability | supported | include file_search_call.results |
| include_logprobs | include | acceptability | supported | include message.output_text.logprobs |
| include_reasoning_encrypted_content | include | acceptability | supported | include reasoning.encrypted_content |
| include_web_search_sources | include | acceptability | supported | include web_search_call.action.sources |
| input_message_array_content_list | input | acceptability | supported | input as message array with input_text content list |
| input_message_array_easy | input | acceptability | supported | input as message array with string content |
| input_string | input | acceptability | supported | input as plain string |
| instructions_behavior | instructions | behavioral | flaky | control=OK_BASE |
| max_output_tokens | sampling | acceptability | supported | max_output_tokens field |
| max_tool_calls | tools | acceptability | supported | max_tool_calls |
| metadata | metadata | acceptability | supported | metadata key-value |
| model | core | acceptability | supported | baseline model field |
| parallel_tool_calls | tools | acceptability | supported | parallel_tool_calls |
| previous_response_id_behavior | conversation | behavioral | supported | checked recall via previous_response_id |
| prompt_cache_key | cache | acceptability | supported | prompt_cache_key field |
| prompt_cache_retention | cache | acceptability | supported | prompt_cache_retention field |
| reasoning | reasoning | acceptability | flaky | reasoning field |
| safety_identifier | safety | acceptability | supported | safety_identifier field |
| service_tier | service | acceptability | supported | service_tier field |
| store | lifecycle | acceptability | supported | store field |
| stream_behavior | streaming | behavioral | supported | SSE markers observed |
| stream_options | streaming | acceptability | supported | stream_options.include_obfuscation |
| stream_true | streaming | acceptability | supported | stream true |
| temperature | sampling | acceptability | supported | temperature field |
| text_format_json_object | text_format | acceptability | supported | text.format json_object |
| text_format_json_object_behavior | text_format | behavioral | flaky | json_object output parsed as object |
| text_format_json_schema | text_format | acceptability | supported | text.format json_schema |
| text_format_json_schema_behavior | text_format | behavioral | ignored | text not parseable as JSON |
| text_format_text | text_format | acceptability | supported | text.format text |
| tool_choice_auto | tools | acceptability | supported | tool_choice auto |
| tool_choice_none | tools | acceptability | supported | tool_choice none |
| tool_choice_required | tools | acceptability | supported | tool_choice required |
| tools_builtin_behavior | tools | behavioral | unknown | web_search: status=0, observed=false; web_extractor: status=200, observed=false; code_interpreter: status=200, observed=false |
| tools_builtin_code_interpreter | tools | acceptability | supported | built-in code_interpreter |
| tools_builtin_web_extractor | tools | acceptability | supported | built-in web_extractor |
| tools_builtin_web_search | tools | acceptability | flaky | built-in web_search |
| tools_function | tools | acceptability | supported | function tool |
| tools_function_call_behavior | tools | behavioral | supported | function_call observed |
| top_logprobs | sampling | acceptability | supported | top_logprobs field |
| top_p | sampling | acceptability | supported | top_p field |
| truncation_auto | context | acceptability | supported | truncation auto |
| truncation_behavior | context | behavioral | unknown | did not observe plain failure threshold within tested sizes |
| truncation_disabled | context | acceptability | supported | truncation disabled |
| user | legacy | acceptability | supported | user field |

### Key Findings

- instructions: **flaky** — control=OK_BASE
- previous_response_id: **supported** — checked recall via previous_response_id
- text.format.json_schema: **ignored** — text not parseable as JSON
- tools/function: **supported** — function_call observed
- stream: **supported** — SSE markers observed
- enable_thinking: **supported** — accepted with observable difference

### Output Structure Observed

- output item types: function_call, message
- message content types: output_text
- function_call sample note: tool_choice required

### Recommended Adapter Strategy

- If `instructions` is not supported, convert instructions into a leading `developer/system` input message.
- If `json_schema` is ignored/rejected, fallback to plain text + JSON extraction + local schema validation retry.
- Keep provider-specific tool type mapping (function vs built-in tools) in adapter layer.

