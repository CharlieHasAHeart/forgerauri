import { z } from "zod";
import type { LlmProvider } from "../../../../llm/provider.js";
import { contractForUxV1Schema } from "../../../design/contract/views.js";
import { uxDesignV1Schema, type UXDesignV1 } from "../../../design/ux/schema.js";
import type { ToolPackage } from "../../types.js";

const inputSchema = z.object({
  goal: z.string().min(1),
  specPath: z.string().min(1),
  contract: contractForUxV1Schema,
  projectRoot: z.string().min(1).optional()
});

const outputSchema = z.object({
  ux: uxDesignV1Schema,
  attempts: z.number().int().positive()
});

const toScreenId = (value: string, fallback: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (normalized.length === 0 || !/^[a-z]/.test(normalized)) return fallback;
  return normalized;
};

const buildSeedUx = (contract: z.infer<typeof contractForUxV1Schema>): UXDesignV1 => {
  const commandScreens = contract.commands.map((command, index) => {
    const id = toScreenId(command.name, `screen_${index + 1}`);
    return {
      id,
      title: command.name.replace(/_/g, " "),
      route: `/${id}`,
      purpose: command.purpose || `Run ${command.name}`,
      dataNeeds: [{ source: "command" as const, command: command.name }],
      actions: [{ label: `Run ${command.name}`, command: command.name }],
      states: { loading: false, empty: "No data", error: "Failed to load" }
    };
  });

  const screens =
    commandScreens.length > 0
      ? commandScreens
      : [
          {
            id: "home",
            title: "Home",
            route: "/",
            purpose: "Overview",
            dataNeeds: [],
            actions: [],
            states: { loading: false, empty: "No data", error: "Failed to load" }
          }
        ];

  return {
    version: "v1",
    navigation: {
      kind: screens.length > 1 ? "sidebar" : "single",
      items: screens.map((screen) => ({ id: screen.id, title: screen.title, route: screen.route }))
    },
    screens
  };
};

export const runDesignUx = async (args: {
  goal: string;
  specPath: string;
  contract: z.infer<typeof contractForUxV1Schema>;
  projectRoot?: string;
  provider: LlmProvider;
}): Promise<{ ux: UXDesignV1; attempts: number; raw: string }> => {
  const messages = [
    {
      role: "system" as const,
      content:
        "You are a UX architect for Tauri v2 desktop app. " +
        "Design IA/screens/actions/states based on provided command contracts. " +
        "Return strict JSON only matching UXDesignV1 schema."
    },
    {
      role: "user" as const,
      content:
        `Goal:\n${args.goal}\n\n` +
        `Spec path:\n${args.specPath}\n\n` +
        `Project root:\n${args.projectRoot ?? "<none>"}\n\n` +
        `Contract:\n${JSON.stringify(args.contract, null, 2)}`
    }
  ];

  try {
    const { data, raw, attempts } = await args.provider.completeJSON(messages, uxDesignV1Schema, {
      temperature: 0,
      maxOutputTokens: 4000
    });

    return {
      ux: data,
      attempts,
      raw
    };
  } catch (error) {
    return {
      ux: buildSeedUx(args.contract),
      attempts: 1,
      raw: error instanceof Error ? error.message : "fallback to deterministic seed ux"
    };
  }
};

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_design_ux",
    version: "1.0.0",
    category: "high",
    description: "Designs UX information architecture, screens, states, and actions from contract.",
    capabilities: ["design", "ux", "information-architecture"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "llm"
    }
  },
  runtime: {
    run: async (input, ctx) => {
      try {
        const out = await runDesignUx({
          goal: input.goal,
          specPath: input.specPath,
          contract: input.contract,
          projectRoot: input.projectRoot,
          provider: ctx.provider
        });

        return {
          ok: true,
          data: {
            ux: out.ux,
            attempts: out.attempts
          },
          meta: { touchedPaths: [] }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "DESIGN_UX_FAILED",
            message: error instanceof Error ? error.message : "ux design failed"
          }
        };
      }
    },
    examples: [
      {
        title: "Design UX from contract",
        toolCall: {
          name: "tool_design_ux",
          input: {
            goal: "Design dashboard and detail screens",
            specPath: "/tmp/spec.json",
            contract: { version: "v1" }
          }
        },
        expected: "Returns UXDesignV1 with navigation/screens/actions/states."
      }
    ]
  }
};
