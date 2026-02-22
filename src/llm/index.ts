import type { LlmProvider } from "./provider.js";
import { OpenAIResponsesProvider } from "./providers/openai_responses.js";
import { loadEnvFile } from "../config/loadEnv.js";

export const getProviderFromEnv = (): LlmProvider => {
  loadEnvFile();
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing. Set OPENAI_API_KEY and optionally OPENAI_MODEL/OPENAI_BASE_URL.");
  }
  return new OpenAIResponsesProvider();
};
