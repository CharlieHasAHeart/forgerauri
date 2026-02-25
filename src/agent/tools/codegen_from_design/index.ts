import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { contractDesignV1Schema, type ContractDesignV1 } from "../../design/contract/schema.js";
import { assertPathInside } from "../../../runtime/policy.js";
import type { ToolPackage } from "../types.js";

const inputSchema = z.object({
  projectRoot: z.string().min(1),
  apply: z.boolean().default(true)
});

const outputSchema = z.object({
  ok: z.literal(true),
  generated: z.array(z.string()),
  summary: z.object({
    wrote: z.number().int().min(0),
    skipped: z.number().int().min(0)
  })
});

type ContractCommand = ContractDesignV1["commands"][number];

const ensureInside = (root: string, target: string): void => {
  const rel = relative(resolve(root), resolve(target));
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.split(sep).includes("..")) {
    throw new Error(`Refusing to write outside project root: ${target}`);
  }
  assertPathInside(root, target);
};

const writeIfChanged = async (filePath: string, content: string, apply: boolean): Promise<"wrote" | "skipped"> => {
  if (!apply) return "skipped";

  if (existsSync(filePath) && readFileSync(filePath, "utf8") === content) {
    return "skipped";
  }

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return "wrote";
};

const toPascalCase = (value: string): string =>
  value
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join("");

const tsType = (type: string): string => {
  if (type === "int" || type === "float") return "number";
  if (type === "boolean") return "boolean";
  if (type === "json") return "unknown";
  return "string";
};

const rustType = (type: string): string => {
  if (type === "int") return "i64";
  if (type === "float") return "f64";
  if (type === "boolean") return "bool";
  if (type === "json") return "serde_json::Value";
  return "String";
};

const tsInterface = (name: string, fields: ContractCommand["inputs"]): string => {
  if (fields.length === 0) {
    return `export type ${name} = Record<string, never>;`;
  }
  const lines = fields.map((field) => `  ${field.name}${field.optional ? "?" : ""}: ${tsType(field.type)};`);
  return `export type ${name} = {\n${lines.join("\n")}\n};`;
};

const rustStruct = (name: string, fields: ContractCommand["inputs"]): string => {
  if (fields.length === 0) {
    return `#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${name} {}`;
  }
  const lines = fields.map((field) => {
    const base = rustType(field.type);
    const finalType = field.optional ? `Option<${base}>` : base;
    return `    pub ${field.name}: ${finalType},`;
  });
  return `#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${name} {\n${lines.join("\n")}\n}`;
};

const templateTsClient = (contract: ContractDesignV1): string => {
  const commands = [...contract.commands].sort((a, b) => a.name.localeCompare(b.name));
  const commandNames = commands.map((cmd) => `'${cmd.name}'`).join(" | ") || "never";

  const typeDefs = commands
    .map((cmd) => {
      const prefix = toPascalCase(cmd.name);
      return `${tsInterface(`${prefix}Input`, cmd.inputs)}\n\n${tsInterface(`${prefix}Output`, cmd.outputs)}`;
    })
    .join("\n\n");

  const metaItems = commands
    .map(
      (cmd) => `  {
    name: ${JSON.stringify(cmd.name)},
    purpose: ${JSON.stringify(cmd.purpose)},
    inputs: ${JSON.stringify(cmd.inputs)},
    outputs: ${JSON.stringify(cmd.outputs)}
  }`
    )
    .join(",\n");

  const runners = commands
    .map((cmd) => {
      const prefix = toPascalCase(cmd.name);
      return `  ${JSON.stringify(cmd.name)}: (args: ${prefix}Input) => invokeCommand<${prefix}Output>(${JSON.stringify(cmd.name)}, { input: args })`;
    })
    .join(",\n");

  return `import { invokeCommand } from "../tauri";

export type CommandName = ${commandNames};

export type CommandFieldType = "string" | "int" | "float" | "boolean" | "json";

export type CommandFieldMeta = {
  name: string;
  type: CommandFieldType;
  optional?: boolean;
  description?: string;
};

export type CommandMeta = {
  name: CommandName;
  purpose: string;
  inputs: CommandFieldMeta[];
  outputs: CommandFieldMeta[];
};

${typeDefs}

export const commandMetas: CommandMeta[] = [
${metaItems}
];

export const listCommands = (): CommandMeta[] => [...commandMetas];

export const getCommandMeta = (name: CommandName): CommandMeta | undefined =>
  commandMetas.find((meta) => meta.name === name);

const typedRunners = {
${runners}
};

export const runCommand = async (name: CommandName, args: Record<string, unknown>): Promise<unknown> => {
  const runner = typedRunners[name];
  return runner(args as never);
};
`;
};

const templateRustCommand = (command: ContractCommand): string => {
  const pascal = toPascalCase(command.name);
  const inputName = `${pascal}Input`;
  const outputName = `${pascal}Output`;

  return `use serde::{Deserialize, Serialize};

use crate::api_response::ApiResponse;
use crate::errors::ApiError;

${rustStruct(inputName, command.inputs)}

${rustStruct(outputName, command.outputs)}

#[tauri::command]
pub async fn ${command.name}(_app: tauri::AppHandle, _input: Option<${inputName}>) -> ApiResponse<${outputName}> {
    ApiResponse::failure(ApiError::internal("TODO: implement ${command.name}"))
}
`;
};

const templateRustMod = (commands: ContractDesignV1["commands"]): string => {
  const sorted = [...commands].sort((a, b) => a.name.localeCompare(b.name));
  const lines = sorted.map((command) => `pub mod ${command.name};`);
  return `${lines.join("\n")}\n`;
};

export const runCodegenFromDesign = async (args: {
  projectRoot: string;
  apply: boolean;
}): Promise<z.infer<typeof outputSchema>> => {
  const root = resolve(args.projectRoot);
  const contractPath = join(root, "forgetauri.contract.json");
  const uxPath = join(root, "src/lib/design/ux.json");
  const implementationPath = join(root, "src/lib/design/implementation.json");
  const deliveryPath = join(root, "src/lib/design/delivery.json");

  if (!existsSync(contractPath)) {
    throw new Error(`Missing required contract file: ${contractPath}`);
  }

  // Optional design artifacts are read for diagnostics/forward compatibility.
  for (const optionalPath of [uxPath, implementationPath, deliveryPath]) {
    if (existsSync(optionalPath)) {
      await readFile(optionalPath, "utf8");
    }
  }

  const contractRaw = JSON.parse(await readFile(contractPath, "utf8")) as unknown;
  const contract = contractDesignV1Schema.parse(contractRaw);

  const targetFiles: Record<string, string> = {
    "src/lib/api/generated/contract.ts": templateTsClient(contract),
    "src-tauri/src/commands/generated/mod.rs": templateRustMod(contract.commands)
  };

  for (const command of contract.commands) {
    targetFiles[`src-tauri/src/commands/generated/${command.name}.rs`] = templateRustCommand(command);
  }

  const generatedRelativePaths = Object.keys(targetFiles).sort((a, b) => a.localeCompare(b));
  const results: Array<"wrote" | "skipped"> = [];

  for (const relativePath of generatedRelativePaths) {
    const absolutePath = join(root, relativePath);
    ensureInside(root, absolutePath);
    results.push(await writeIfChanged(absolutePath, targetFiles[relativePath]!, args.apply));
  }

  const wrote = results.filter((result) => result === "wrote").length;

  return {
    ok: true,
    generated: generatedRelativePaths,
    summary: {
      wrote: args.apply ? wrote : 0,
      skipped: args.apply ? results.length - wrote : results.length
    }
  };
};

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_codegen_from_design",
    version: "1.0.0",
    category: "high",
    description: "Deterministically generates typed TS/Rust command glue from contract design artifacts.",
    capabilities: ["codegen", "generated", "contract", "rust", "ts"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "fs"
    }
  },
  runtime: {
    run: async (input) => {
      try {
        const data = await runCodegenFromDesign({
          projectRoot: input.projectRoot,
          apply: input.apply
        });

        return {
          ok: true,
          data,
          meta: {
            touchedPaths: data.generated.map((relativePath) => join(resolve(input.projectRoot), relativePath))
          }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "CODEGEN_FROM_DESIGN_FAILED",
            message: error instanceof Error ? error.message : "codegen from design failed"
          }
        };
      }
    },
    examples: [
      {
        title: "Generate command glue files",
        toolCall: {
          name: "tool_codegen_from_design",
          input: {
            projectRoot: "./generated/app",
            apply: true
          }
        },
        expected: "Writes generated TS/Rust command glue files based on forgetauri.contract.json."
      }
    ]
  }
};
