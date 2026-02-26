import { z } from "zod";
import type { LlmProvider } from "../../../../llm/provider.js";
import { contractDesignV1Schema } from "../../../design/contract/schema.js";
import { implementationDesignV1Schema, type ImplementationDesignV1 } from "../../../design/implementation/schema.js";
import { uxDesignV1Schema } from "../../../design/ux/schema.js";
import type { ToolPackage } from "../../types.js";

const inputSchema = z.object({
  goal: z.string().min(1),
  contract: contractDesignV1Schema,
  ux: uxDesignV1Schema.optional(),
  projectRoot: z.string().min(1).optional()
});

const outputSchema = z.object({
  impl: implementationDesignV1Schema,
  attempts: z.number().int().positive()
});

export const runDesignImplementation = async (args: {
  goal: string;
  contract: z.infer<typeof contractDesignV1Schema>;
  ux?: z.infer<typeof uxDesignV1Schema>;
  projectRoot?: string;
  provider: LlmProvider;
}): Promise<{ impl: ImplementationDesignV1; attempts: number; raw: string }> => {
  const messages = [
    {
      role: "system" as const,
      content:
        "You are a Rust + Tauri implementation architect. " +
        "Design service/repo layering, error model, and frontend invoke strategy. " +
        "Return strict JSON only matching ImplementationDesignV1 schema."
    },
    {
      role: "user" as const,
      content:
        `Goal:\n${args.goal}\n\n` +
        `Project root:\n${args.projectRoot ?? "<none>"}\n\n` +
        `Contract:\n${JSON.stringify(args.contract, null, 2)}\n\n` +
        `UX (optional):\n${args.ux ? JSON.stringify(args.ux, null, 2) : "<none>"}`
    }
  ];

  const { data, raw, attempts } = await args.provider.completeJSON(messages, implementationDesignV1Schema, {
    temperature: 0,
    maxOutputTokens: 4000
  });

  return {
    impl: data,
    attempts,
    raw
  };
};

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_design_implementation",
    version: "1.0.0",
    category: "high",
    description: "Designs Rust service/repo layering and frontend invocation strategy.",
    capabilities: ["design", "implementation", "rust", "frontend"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "llm"
    }
  },
  runtime: {
    run: async (input, ctx) => {
      try {
        const out = await runDesignImplementation({
          goal: input.goal,
          contract: input.contract,
          ux: input.ux,
          projectRoot: input.projectRoot,
          provider: ctx.provider
        });

        return {
          ok: true,
          data: {
            impl: out.impl,
            attempts: out.attempts
          },
          meta: { touchedPaths: [] }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "DESIGN_IMPLEMENTATION_FAILED",
            message: error instanceof Error ? error.message : "implementation design failed"
          }
        };
      }
    },
    examples: [
      {
        title: "Design implementation plan",
        toolCall: {
          name: "tool_design_implementation",
          input: {
            goal: "Design service and repo responsibilities",
            contract: { version: "v1" }
          }
        },
        expected: "Returns ImplementationDesignV1 with rust/frontend strategy."
      }
    ]
  }
};
