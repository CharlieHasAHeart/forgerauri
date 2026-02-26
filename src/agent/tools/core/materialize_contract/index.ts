import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { contractDesignV1Schema, type ContractDesignV1 } from "../../../contract/schema.js";
import { toAppSlug } from "../../../../generator/templates.js";
import type { ToolPackage } from "../../types.js";

const inputSchema = z.object({
  contract: contractDesignV1Schema,
  outDir: z.string().min(1),
  appDir: z.string().min(1).optional(),
  appNameHint: z.string().optional(),
  apply: z.boolean().default(true)
});

const outputSchema = z.object({
  appDir: z.string(),
  contractPath: z.string(),
  summary: z.object({
    wrote: z.number(),
    skipped: z.number()
  })
});

const quote = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;

const storageType = (type: ContractDesignV1["dataModel"]["tables"][number]["columns"][number]["type"]): string => {
  if (type === "json") return "TEXT";
  if (type === "integer") return "INTEGER";
  if (type === "real") return "REAL";
  if (type === "blob") return "BLOB";
  return "TEXT";
};

const buildContractSql = (contract: ContractDesignV1): string => {
  const tables = [...contract.dataModel.tables].sort((a, b) => a.name.localeCompare(b.name));
  const lines: string[] = [
    "-- Auto-generated from forgetauri.contract.json",
    "-- JSON columns are stored as TEXT",
    ""
  ];

  for (const table of tables) {
    lines.push(`CREATE TABLE IF NOT EXISTS ${quote(table.name)} (`);

    const columnLines = table.columns.map((column) => {
      const parts = [`  ${quote(column.name)} ${storageType(column.type)}`];
      if (column.primaryKey) parts.push("PRIMARY KEY");
      if (!column.nullable && !column.primaryKey) parts.push("NOT NULL");
      if (column.default !== undefined) parts.push(`DEFAULT ${column.default}`);
      return parts.join(" ");
    });

    lines.push(columnLines.join(",\n"));
    lines.push(");");

    const indices = [...(table.indices ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    for (const index of indices) {
      lines.push(
        `CREATE ${index.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${quote(index.name)} ON ${quote(table.name)} (${index.columns
          .map(quote)
          .join(", ")});`
      );
    }

    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
};

const writeIfChanged = async (path: string, content: string, apply: boolean): Promise<"wrote" | "skipped"> => {
  if (!apply) return "skipped";

  if (existsSync(path)) {
    const current = readFileSync(path, "utf8");
    if (current === content) return "skipped";
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return "wrote";
};

export const runMaterializeContract = async (args: {
  contract: ContractDesignV1;
  outDir: string;
  appDir?: string;
  appNameHint?: string;
  apply: boolean;
}): Promise<z.infer<typeof outputSchema>> => {
  const appName = args.appNameHint && args.appNameHint.trim().length > 0 ? args.appNameHint : args.contract.app.name;
  const appDir = args.appDir ? resolve(args.appDir) : join(resolve(args.outDir), toAppSlug(appName));

  const contractJsonPath = join(appDir, "forgetauri.contract.json");
  const contractClientPath = join(appDir, "src/lib/contract/contract.json");
  const contractSqlPath = join(appDir, "src-tauri/migrations/0004_contract.sql");

  const contractJson = `${JSON.stringify(args.contract, null, 2)}\n`;
  const contractSql = buildContractSql(args.contract);

  const results = await Promise.all([
    writeIfChanged(contractJsonPath, contractJson, args.apply),
    writeIfChanged(contractClientPath, contractJson, args.apply),
    writeIfChanged(contractSqlPath, contractSql, args.apply)
  ]);

  const wrote = results.filter((v) => v === "wrote").length;
  const skipped = results.length - wrote;

  return {
    appDir,
    contractPath: contractJsonPath,
    summary: {
      wrote: args.apply ? wrote : 0,
      skipped: args.apply ? skipped : results.length
    }
  };
};

export const toolPackage: ToolPackage<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  manifest: {
    name: "tool_materialize_contract",
    version: "1.0.0",
    category: "high",
    description: "Materializes contract design into contract JSON and SQL migration files.",
    capabilities: ["materialize", "contract", "fs"],
    inputSchema,
    outputSchema,
    safety: {
      sideEffects: "fs"
    }
  },
  runtime: {
    run: async (input) => {
      try {
        const data = await runMaterializeContract({
          contract: input.contract,
          outDir: input.outDir,
          appDir: input.appDir,
          appNameHint: input.appNameHint,
          apply: input.apply
        });

        const touchedPaths = [
          data.contractPath,
          join(data.appDir, "src/lib/contract/contract.json"),
          join(data.appDir, "src-tauri/migrations/0004_contract.sql")
        ];

        return {
          ok: true,
          data,
          meta: { touchedPaths }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "MATERIALIZE_CONTRACT_FAILED",
            message: error instanceof Error ? error.message : "contract materialization failed"
          }
        };
      }
    },
    examples: [
      {
        title: "Materialize contract in apply mode",
        toolCall: {
          name: "tool_materialize_contract",
          input: { contract: { version: "v1" }, outDir: "./generated", apply: true }
        },
        expected: "Writes contract JSON and SQL migration into app directory."
      }
    ]
  }
};
