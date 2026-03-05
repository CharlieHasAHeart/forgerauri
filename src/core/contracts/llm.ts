export type LlmRole = "system" | "user" | "assistant";

export type LlmMessage = {
  role: LlmRole;
  content: string;
};

export type LlmJsonResult<T> = {
  data: T;
  raw: string;
  attempts?: number;
  responseId?: string;
  usage?: unknown;
  previousResponseIdSent?: string;
};

export type LlmPort = {
  name: string;
  model?: string;
  complete?: (messages: LlmMessage[], opts?: Record<string, unknown>) => Promise<{ text: string; responseId?: string; usage?: unknown }>;
  completeJSON?: <T>(
    messages: LlmMessage[],
    schema: unknown,
    opts?: Record<string, unknown>
  ) => Promise<LlmJsonResult<T>>;
};
