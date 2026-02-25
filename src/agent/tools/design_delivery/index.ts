import { z } from "zod";
import type { LlmProvider } from "../../../llm/provider.js";
import { contractDesignV1Schema } from "../../design/contract/schema.js";
import { deliveryDesignV1Schema, type DeliveryDesignV1 } from "../../design/delivery/schema.js";
import type { ToolPackage } from "../types.js";

const inputSchema = z.object({
  goal: z.string().min(1),
  contract: contractDesignV1Schema,
  projectRoot: z.string().min(1).optional()
});

const outputSchema = z.object({
  delivery: deliveryDesignV1Schema,
  attempts: z.number().int().positive()
});

export const runDesignDelivery = async (args: {
  goal: string;
  contract: z.infer<typeof contractDesignV1Schema>;
  projectRoot?: string;
  provider: LlmProvider;
}): Promise<{ delivery: DeliveryDesignV1; attempts: number; raw: string }> => {
  const messages = [
    {
      role: "system" as const,
      content:
        "You are a release and delivery architect for Tauri projects. " +
        "Design verification gates, preflight checks, and required assets. " +
        "Return strict JSON only matching DeliveryDesignV1 schema."
    },
    {
      role: "user" as const,
      content:
        `Goal:\n${args.goal}\n\n` +
        `Project root:\n${args.projectRoot ?? "<none>"}\n\n` +
        `Contract:\n${JSON.stringify(args.contract, null, 2)}\n\n` +
        "Constraints:\n- Verify policy must be practical for pnpm/cargo/tauri\n- Asset checks should include icon requirements"
    }
  ];

  const { data, raw, attempts } = await args.provider.completeJSON(messages, deliveryDesignV1Schema, {
    temperature: 0,
    maxOutputTokens: 3500
  });

  return {
    delivery: data,
    attempts,
    raw
  };
};

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_design_delivery",
    version: "1.0.0",
    category: "high",
    description: "Designs verify policy, preflight checks, and delivery assets.",
    capabilities: ["design", "delivery", "verify-policy"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "llm"
    }
  },
  runtime: {
    run: async (input, ctx) => {
      try {
        const out = await runDesignDelivery({
          goal: input.goal,
          contract: input.contract,
          projectRoot: input.projectRoot,
          provider: ctx.provider
        });

        return {
          ok: true,
          data: {
            delivery: out.delivery,
            attempts: out.attempts
          },
          meta: { touchedPaths: [] }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "DESIGN_DELIVERY_FAILED",
            message: error instanceof Error ? error.message : "delivery design failed"
          }
        };
      }
    },
    examples: [
      {
        title: "Design delivery strategy",
        toolCall: {
          name: "tool_design_delivery",
          input: {
            goal: "Define verify policy and assets",
            contract: { version: "v1" }
          }
        },
        expected: "Returns DeliveryDesignV1 with verify gates and preflight checks."
      }
    ]
  }
};
