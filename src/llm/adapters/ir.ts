export type AgentMessageIR = {
  role: "system" | "developer" | "user" | "assistant";
  content: string;
  phase?: "commentary" | "final_answer";
};

export type ToolIR = {
  type: string;
  [key: string]: unknown;
};

export type AgentRequestIR = {
  messages: AgentMessageIR[];
  instructions?: string;
  previousResponseId?: string;
  model?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  store?: boolean;
  truncation?: "auto" | "disabled";
  include?: string[];
  metadata?: Record<string, string | number | boolean>;
  promptCacheKey?: string;
  safetyIdentifier?: string;
  contextManagement?: Array<{ type: "compaction"; compactThreshold?: number }>;
  textFormat?:
    | { type: "text" }
    | { type: "json_object" }
    | { type: "json_schema"; name: string; schema: unknown; strict?: boolean; description?: string };
  tools?: ToolIR[];
  toolChoice?: "none" | "auto" | "required";
  enableThinking?: boolean;
};

export type AgentResponseIR = {
  text: string;
  responseId?: string;
  usage?: unknown;
  refusals?: string[];
  functionCalls?: Array<{ name: string; arguments: string; call_id: string }>;
  raw: unknown;
  output?: unknown[];
};
