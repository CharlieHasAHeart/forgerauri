import type { LlmProvider } from "./provider.js";
import { DashScopeResponsesProvider } from "./providers/dashscope_responses.js";
import { loadEnvFile } from "../config/loadEnv.js";

export const getProviderFromEnv = (): LlmProvider => {
  loadEnvFile();
  if (process.env.DASHSCOPE_API_KEY) {
    return new DashScopeResponsesProvider();
  }
  throw new Error(
    "DASHSCOPE_API_KEY is missing. Set DASHSCOPE_API_KEY and optionally DASHSCOPE_BASE_URL / DASHSCOPE_MODEL."
  );
};
