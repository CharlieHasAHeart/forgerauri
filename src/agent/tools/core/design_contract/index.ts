import { readFile } from "node:fs/promises";
import { z } from "zod";
import { contractDesignV1Schema, type ContractDesignV1 } from "../../../design/contract/schema.js";
import type { LlmProvider } from "../../../../llm/provider.js";
import { parseSpecFromRaw } from "../../../../spec/loadSpec.js";
import type { SpecIR } from "../../../../spec/schema.js";
import type { ToolPackage } from "../../types.js";

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

const toSnakeCase = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

const withUniqueName = (base: string, used: Set<string>, fallbackPrefix: string, index: number): string => {
  const normalizedBase = toSnakeCase(base);
  const root = normalizedBase.length > 0 && /^[a-z]/.test(normalizedBase) ? normalizedBase : `${fallbackPrefix}_${index + 1}`;
  let candidate = root;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${root}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
};

const inferIoType = (value: unknown): "string" | "int" | "float" | "boolean" | "json" => {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (typeof value === "string") return "string";
  return "json";
};

const toSqlType = (value: string): "text" | "integer" | "real" | "blob" | "json" => {
  const normalized = value.trim().toLowerCase();
  if (["text", "string", "varchar", "char"].includes(normalized)) return "text";
  if (["int", "integer", "bool", "boolean"].includes(normalized)) return "integer";
  if (["real", "float", "double", "number", "decimal"].includes(normalized)) return "real";
  if (["blob", "binary", "bytes"].includes(normalized)) return "blob";
  if (["json", "object", "array"].includes(normalized)) return "json";
  return "text";
};

const buildFallbackSeedContract = (raw: unknown): ContractDesignV1 => {
  const rawObject = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawApp = (rawObject.app && typeof rawObject.app === "object" ? rawObject.app : {}) as Record<string, unknown>;
  const name = typeof rawApp.name === "string" && rawApp.name.trim().length > 0 ? rawApp.name.trim() : "generated_app";
  const description =
    typeof rawApp.one_liner === "string" && rawApp.one_liner.trim().length > 0
      ? rawApp.one_liner.trim()
      : undefined;

  return {
    version: "v1",
    app: { name, description },
    commands: [],
    dataModel: {
      tables: [],
      migrations: { strategy: "versioned" }
    }
  };
};

const buildSeedContract = (raw: unknown): ContractDesignV1 => {
  try {
    const spec = parseSpecFromRaw(raw);
    return buildSeedContractFromSpec(spec);
  } catch {
    return buildFallbackSeedContract(raw);
  }
};

const buildSeedContractFromSpec = (spec: SpecIR): ContractDesignV1 => {
  const usedCommandNames = new Set<string>();
  const commands = spec.rust_commands.map((cmd, commandIndex) => {
    const commandName = withUniqueName(cmd.name, usedCommandNames, "command", commandIndex);

    const usedInputNames = new Set<string>();
    const inputs = Object.entries(cmd.input ?? {}).map(([key, value], inputIndex) => ({
      name: withUniqueName(key, usedInputNames, "input", inputIndex),
      type: inferIoType(value)
    }));

    const usedOutputNames = new Set<string>();
    const outputs = Object.entries(cmd.output ?? {}).map(([key, value], outputIndex) => ({
      name: withUniqueName(key, usedOutputNames, "output", outputIndex),
      type: inferIoType(value)
    }));

    return {
      name: commandName,
      purpose: cmd.purpose?.trim() || `Handle ${commandName}`,
      inputs,
      outputs,
      idempotent: true
    };
  });

  const usedTableNames = new Set<string>();
  const tables = spec.data_model.tables.map((table, tableIndex) => {
    const tableName = withUniqueName(table.name, usedTableNames, "table", tableIndex);
    const usedColumnNames = new Set<string>();
    const columns = table.columns.map((column, columnIndex) => ({
      name: withUniqueName(column.name, usedColumnNames, "column", columnIndex),
      type: toSqlType(column.type)
    }));
    return { name: tableName, columns };
  });

  return {
    version: "v1",
    app: {
      name: spec.app.name,
      description: spec.app.one_liner
    },
    commands,
    dataModel: {
      tables,
      migrations: { strategy: "versioned" }
    }
  };
};

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
  const seedContract = buildSeedContract(raw);

  const rawSpecText = truncate(JSON.stringify(raw, null, 2));
  const seedContractText = truncate(JSON.stringify(seedContract, null, 2));

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
        `Deterministic seed contract (must remain schema-valid):\n${seedContractText}\n\n` +
        "Stack constraints:\n- Tauri v2\n- Rust commands\n- SQLite via rusqlite\n- Deterministic contract names in snake_case"
    }
  ];

  try {
    const { data, raw: llmRaw, attempts } = await args.provider.completeJSON(messages, contractDesignV1Schema, {
      temperature: 0,
      maxOutputTokens: 5000
    });

    return {
      contract: data,
      attempts,
      raw: llmRaw
    };
  } catch (error) {
    return {
      contract: seedContract,
      attempts: 1,
      raw: error instanceof Error ? error.message : "fallback to deterministic seed contract"
    };
  }
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
