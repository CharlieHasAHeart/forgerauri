import type { LlmProvider } from "./provider.js";
import { DashScopeResponsesProvider } from "./providers/dashscope_responses.js";
import { OpenAIResponsesProvider } from "./providers/openai_responses.js";
import { loadEnvFile } from "../config/loadEnv.js";

export const getProviderFromEnv = (): LlmProvider => {
  loadEnvFile();
  if (process.env.OPENAI_API_KEY) {
    return new OpenAIResponsesProvider();
  }
  if (process.env.DASHSCOPE_API_KEY) {
    return new DashScopeResponsesProvider();
  }
  throw new Error(
    "Missing LLM credentials. Set OPENAI_API_KEY (optionally OPENAI_BASE_URL / OPENAI_MODEL) or DASHSCOPE_API_KEY (optionally DASHSCOPE_BASE_URL / DASHSCOPE_MODEL)."
  );
};
