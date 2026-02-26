import { parseResponsesOutput } from "../responses/parse.js";
import type { ResponsesAdapter } from "./base.js";
import type { AgentRequestIR, AgentResponseIR } from "./ir.js";

type ResponseInputItem = {
  type: "message";
  role: "system" | "developer" | "user" | "assistant";
  content: Array<{ type: "input_text"; text: string }>;
};

const toInputItems = (ir: AgentRequestIR): ResponseInputItem[] =>
  ir.messages.map((message) => ({
    type: "message",
    role: message.role,
    content: [{ type: "input_text", text: message.content }]
  }));

export class OpenAIAdapter implements ResponsesAdapter {
  readonly provider = "openai" as const;

  readonly caps = {
    supportsInstructions: true,
    supportsEnableThinking: false,
    supportsTextFormatJsonSchema: true,
    supportsContextManagement: true,
    supportsTruncation: true
  };

  toRequestBody(ir: AgentRequestIR): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: ir.model,
      input: toInputItems(ir)
    };

    if (typeof ir.temperature === "number") body.temperature = ir.temperature;
    if (typeof ir.topP === "number") body.top_p = ir.topP;
    if (typeof ir.maxOutputTokens === "number") body.max_output_tokens = ir.maxOutputTokens;
    if (typeof ir.instructions === "string") body.instructions = ir.instructions;
    if (typeof ir.previousResponseId === "string") body.previous_response_id = ir.previousResponseId;
    if (typeof ir.store === "boolean") body.store = ir.store;
    if (typeof ir.truncation === "string") body.truncation = ir.truncation;
    if (Array.isArray(ir.include)) body.include = ir.include;
    if (ir.metadata) body.metadata = ir.metadata;
    if (typeof ir.promptCacheKey === "string") body.prompt_cache_key = ir.promptCacheKey;
    if (typeof ir.safetyIdentifier === "string") body.safety_identifier = ir.safetyIdentifier;
    if (Array.isArray(ir.contextManagement)) {
      body.context_management = ir.contextManagement.map((item) => ({
        type: item.type,
        compact_threshold: item.compactThreshold
      }));
    }
    if (ir.textFormat) body.text = { format: ir.textFormat };
    if (Array.isArray(ir.tools) && ir.tools.length > 0) body.tools = ir.tools;
    if (typeof ir.toolChoice === "string") body.tool_choice = ir.toolChoice;

    return body;
  }

  fromRawResponse(raw: unknown): AgentResponseIR {
    const parsed = parseResponsesOutput(raw);
    const rawObj = raw as Record<string, unknown>;
    const fallback = typeof rawObj.output_text === "string" ? rawObj.output_text : "";

    return {
      text: parsed.text || fallback || JSON.stringify(raw),
      responseId: typeof rawObj.id === "string" ? rawObj.id : undefined,
      usage: rawObj.usage,
      refusals: parsed.refusals,
      functionCalls: parsed.functionCalls,
      raw,
      output: parsed.output
    };
  }
}
