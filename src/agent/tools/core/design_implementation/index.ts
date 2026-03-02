import { z } from "zod";
import type { LlmProvider } from "../../../../llm/provider.js";
import { contractForImplementationV1Schema } from "../../../design/contract/views.js";
import { implementationDesignV1Schema, type ImplementationDesignV1 } from "../../../design/implementation/schema.js";
import { uxDesignV1Schema } from "../../../design/ux/schema.js";
import type { ToolPackage } from "../../types.js";

const inputSchema = z.object({
  goal: z.string().min(1),
  contract: contractForImplementationV1Schema,
  ux: uxDesignV1Schema.optional(),
  projectRoot: z.string().min(1).optional()
});

const outputSchema = z.object({
  impl: implementationDesignV1Schema,
  attempts: z.number().int().positive()
});

const toSnakeCase = (value: string, fallback: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (normalized.length === 0 || !/^[a-z]/.test(normalized)) return fallback;
  return normalized;
};

const buildSeedImplementation = (
  contract: z.infer<typeof contractForImplementationV1Schema>
): ImplementationDesignV1 => {
  const fallbackTable = contract.dataModel.tables[0]?.name ?? "app_data";
  const tableSet = new Set(contract.dataModel.tables.map((table) => table.name));
  const tableForService = tableSet.size > 0 ? fallbackTable : "app_data";

  const services = contract.commands.map((command, index) => ({
    name: toSnakeCase(`${command.name}_service`, `service_${index + 1}`),
    responsibilities: [command.purpose || `Handle ${command.name}`],
    usesTables: [tableForService]
  }));

  const repos = Array.from(tableSet.size > 0 ? tableSet : new Set(["app_data"])).map((table, index) => ({
    name: toSnakeCase(`${table}_repo`, `repo_${index + 1}`),
    table,
    operations: ["get", "list", "upsert"]
  }));

  return {
    version: "v1",
    rust: {
      layering: "commands_service_repo",
      services,
      repos,
      errorModel: {
        pattern: "thiserror+ApiResponse",
        errorCodes: ["INTERNAL_ERROR"]
      }
    },
    frontend: {
      apiPattern: "invoke_wrapper+typed_meta",
      stateManagement: "local",
      validation: "simple"
    }
  };
};

export const runDesignImplementation = async (args: {
  goal: string;
  contract: z.infer<typeof contractForImplementationV1Schema>;
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

  try {
    const { data, raw, attempts } = await args.provider.completeJSON(messages, implementationDesignV1Schema, {
      temperature: 0,
      maxOutputTokens: 4000
    });

    return {
      impl: data,
      attempts,
      raw
    };
  } catch (error) {
    return {
      impl: buildSeedImplementation(args.contract),
      attempts: 1,
      raw: error instanceof Error ? error.message : "fallback to deterministic implementation seed"
    };
  }
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
