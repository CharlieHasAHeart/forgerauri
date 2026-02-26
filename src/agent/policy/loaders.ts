import { readFile } from "node:fs/promises";
import { z } from "zod";
import { successCriteriaSchema } from "../plan/schema.js";
import type { AgentPolicy } from "./policy.js";

const policySchema = z.object({
  tech_stack: z.record(z.string(), z.unknown()),
  tech_stack_locked: z.boolean(),
  acceptance: z.object({
    locked: z.boolean(),
    criteria: z.array(successCriteriaSchema).optional()
  }),
  safety: z.object({
    allowed_tools: z.array(z.string()),
    allowed_commands: z.array(z.string())
  }),
  budgets: z.object({
    max_steps: z.number().int().positive(),
    max_actions_per_task: z.number().int().positive(),
    max_retries_per_task: z.number().int().positive(),
    max_replans: z.number().int().nonnegative()
  }),
  userExplicitlyAllowedRelaxAcceptance: z.boolean().optional()
});

export const parsePolicyInput = async (input?: string): Promise<AgentPolicy | undefined> => {
  if (!input) return undefined;
  const trimmed = input.trim();
  const raw = trimmed.startsWith("{") ? trimmed : await readFile(trimmed, "utf8");
  return policySchema.parse(JSON.parse(raw));
};
