import { parseResponsesOutput } from "../responses/parse.js";
import type { ResponsesAdapter } from "./base.js";
import type { AgentRequestIR, AgentResponseIR, AgentMessageIR } from "./ir.js";

type ResponseInputItem = {
  type: "message";
  role: "system" | "developer" | "user" | "assistant";
  content: Array<{ type: "input_text"; text: string }>;
};

const prependInstructions = (messages: AgentMessageIR[], instructions?: string): AgentMessageIR[] => {
  if (!instructions || instructions.trim().length === 0) return messages;
  return [{ role: "developer", content: instructions.trim() }, ...messages];
};

const toInputItems = (messages: AgentMessageIR[]): ResponseInputItem[] =>
  messages.map((message) => ({
    type: "message",
    role: message.role,
    content: [{ type: "input_text", text: message.content }]
  }));

export class DashScopeAdapter implements ResponsesAdapter {
  readonly provider = "dashscope" as const;

  readonly caps = {
    supportsInstructions: false,
    supportsEnableThinking: true,
    supportsTextFormatJsonSchema: false,
    supportsContextManagement: false,
    supportsTruncation: false,
    supportedToolTypes: new Set(["function", "web_search", "web_extractor", "code_interpreter"])
  };

  toRequestBody(ir: AgentRequestIR): Record<string, unknown> {
    const withInstructions = prependInstructions(ir.messages, ir.instructions);

    const body: Record<string, unknown> = {
      model: ir.model,
      input: toInputItems(withInstructions)
    };

    // DashScope compatible-mode whitelist mapping.
    if (typeof ir.previousResponseId === "string") body.previous_response_id = ir.previousResponseId;
    if (typeof ir.temperature === "number") body.temperature = ir.temperature;
    if (typeof ir.topP === "number") body.top_p = ir.topP;
    if (typeof ir.maxOutputTokens === "number") body.max_output_tokens = ir.maxOutputTokens;
    if (typeof ir.enableThinking === "boolean") body.enable_thinking = ir.enableThinking;

    if (Array.isArray(ir.tools) && ir.tools.length > 0) {
      const filtered = this.caps.supportedToolTypes
        ? ir.tools.filter((tool) => typeof tool.type === "string" && this.caps.supportedToolTypes?.has(tool.type))
        : ir.tools;
      if (filtered.length > 0) body.tools = filtered;
    }
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
