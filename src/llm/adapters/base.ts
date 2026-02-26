import type { AgentRequestIR, AgentResponseIR } from "./ir.js";

export type AdapterCapabilities = {
  supportsInstructions: boolean;
  supportsEnableThinking: boolean;
  supportsTextFormatJsonSchema: boolean;
  supportsContextManagement: boolean;
  supportsTruncation: boolean;
  supportedToolTypes?: Set<string>;
};

export interface ResponsesAdapter {
  readonly provider: "openai" | "dashscope";
  readonly caps: AdapterCapabilities;
  toRequestBody(ir: AgentRequestIR): Record<string, unknown>;
  fromRawResponse(raw: unknown): AgentResponseIR;
}
