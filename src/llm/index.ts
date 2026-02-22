import type { LlmProvider } from "./provider.js";
import { OpenAIResponsesProvider } from "./providers/openai_responses.js";

export const getProviderFromEnv = (): LlmProvider => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing. Set OPENAI_API_KEY and optionally OPENAI_MODEL/OPENAI_BASE_URL.");
  }
  return new OpenAIResponsesProvider();
};
