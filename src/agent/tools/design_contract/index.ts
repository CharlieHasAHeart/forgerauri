import { readFile } from "node:fs/promises";
import { z } from "zod";
import { contractDesignV1Schema, type ContractDesignV1 } from "../../contract/schema.js";
import type { LlmProvider } from "../../../llm/provider.js";
import type { ToolPackage } from "../types.js";

const inputSchema = z.object({
  goal: z.string().min(1),
  specPath: z.string().min(1),
  rawSpec: z.unknown().optional(),
  projectRoot: z.string().min(1).optional()
});

const outputSchema = z.object({
  contract: contractDesignV1Schema,
  attempts: z.number().int().positive()
});

const truncate = (value: string, max = 120000): string => (value.length > max ? `${value.slice(0, max)}\n...<truncated>` : value);

export const runDesignContract = async (args: {
  goal: string;
  specPath: string;
  rawSpec?: unknown;
  projectRoot?: string;
  provider: LlmProvider;
}): Promise<{ contract: ContractDesignV1; attempts: number; raw: string }> => {
  const raw =
    args.rawSpec !== undefined
      ? args.rawSpec
      : (JSON.parse(await readFile(args.specPath, "utf8")) as unknown);

  const rawSpecText = truncate(JSON.stringify(raw, null, 2));

  const messages = [
    {
      role: "system" as const,
      content:
        "You are a software architect for a Tauri v2 + Rust + SQLite desktop app. " +
        "Design business contracts with command I/O and data model. " +
        "Output JSON only, strictly matching the provided schema."
    },
    {
      role: "user" as const,
      content:
        `Goal:\n${args.goal}\n\n` +
        `Spec path:\n${args.specPath}\n\n` +
        `Project root (optional context):\n${args.projectRoot ?? "<none>"}\n\n` +
        `Raw spec:\n${rawSpecText}\n\n` +
        "Stack constraints:\n- Tauri v2\n- Rust commands\n- SQLite via rusqlite\n- Deterministic contract names in snake_case"
    }
  ];

  const { data, raw: llmRaw, attempts } = await args.provider.completeJSON(messages, contractDesignV1Schema, {
    temperature: 0,
    maxOutputTokens: 5000
  });

  return {
    contract: data,
    attempts,
    raw: llmRaw
  };
};

export const toolPackage: ToolPackage<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  manifest: {
    name: "tool_design_contract",
    version: "1.0.0",
    category: "high",
    description: "Designs command/data contracts from goal + raw spec using LLM structured output.",
    capabilities: ["design", "contract", "business"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "llm"
    }
  },
  runtime: {
    run: async (input, ctx) => {
      try {
        const result = await runDesignContract({
          goal: input.goal,
          specPath: input.specPath,
          rawSpec: input.rawSpec,
          projectRoot: input.projectRoot,
          provider: ctx.provider
        });

        return {
          ok: true,
          data: { contract: result.contract, attempts: result.attempts },
          meta: { touchedPaths: [] }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "DESIGN_CONTRACT_FAILED",
            message: error instanceof Error ? error.message : "contract design failed"
          }
        };
      }
    },
    examples: [
      {
        title: "Design from spec",
        toolCall: {
          name: "tool_design_contract",
          input: {
            goal: "Design commands and schema for lint/fix workflows",
            specPath: "/tmp/spec.json"
          }
        },
        expected: "Returns a validated v1 contract design payload."
      }
    ]
  }
};
