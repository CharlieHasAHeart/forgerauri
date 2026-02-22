import type { SpecIR } from "../../spec/schema.js";
import { parseSpecType, toPascalCase, toRustIdent, toSnakeCase } from "./typesMap.js";

type CommandField = {
  name: string;
  rustIdent: string;
  serdeRename: boolean;
  specType: ReturnType<typeof parseSpecType>;
};

type CommandDef = {
  originalName: string;
  invokeName: string;
  moduleName: string;
  modelName: string;
  serviceFnName: string;
  inputStruct: string;
  outputStruct: string;
  inputFields: CommandField[];
  outputFields: CommandField[];
};

const escapeRust = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const asDict = (value: Record<string, unknown> | undefined): Record<string, unknown> => value ?? {};

const sortedEntries = (value: Record<string, unknown>): Array<[string, unknown]> =>
  Object.entries(value).sort(([left], [right]) => left.localeCompare(right));

const parseFields = (dict: Record<string, unknown>): CommandField[] =>
  sortedEntries(dict).map(([name, typeValue]) => {
    const rustIdent = toRustIdent(name);
    return {
      name,
      rustIdent,
      serdeRename: rustIdent !== name,
      specType: parseSpecType(typeValue)
    };
  });

const buildCommandDefs = (ir: SpecIR): CommandDef[] =>
  [...ir.rust_commands]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((command) => {
      const invokeName = toSnakeCase(command.name);
      const modelName = toPascalCase(command.name);
      const inputStruct = `${modelName}Input`;
      const outputStruct = `${modelName}Output`;

      return {
        originalName: command.name,
        invokeName,
        moduleName: invokeName,
        modelName,
        serviceFnName: `run_${invokeName}`,
        inputStruct,
        outputStruct,
        inputFields: parseFields(asDict(command.input as Record<string, unknown>)),
        outputFields: parseFields(asDict(command.output as Record<string, unknown>))
      };
    });

const rustFieldLine = (field: CommandField): string => {
  const lines: string[] = [];
  if (field.serdeRename) {
    lines.push(`    #[serde(rename = "${escapeRust(field.name)}")]`);
  }
  lines.push(`    pub ${field.rustIdent}: ${field.specType.rustType},`);
  return lines.join("\n");
};

const tsTypeExpr = (field: CommandField): string => {
  const typeName = field.specType.optional ? field.specType.tsType.replace(" | undefined", "") : field.specType.tsType;
  return typeName;
};

const rustOutputDefault = (field: CommandField): string => {
  const base = field.specType.base;
  const lowered = field.rustIdent.toLowerCase();
  if (field.specType.optional) {
    if (lowered === "ok") {
      return "Some(true)";
    }
    if (lowered === "message") {
      return 'Some("ok".to_string())';
    }
    return "None";
  }

  if (lowered === "ok") {
    return "true";
  }
  if (lowered === "message") {
    return '"ok".to_string()';
  }

  if (base === "float") {
    return "0.0";
  }

  return field.specType.rustDefault;
};

export const templateCommandRunsMigration = (): string => `CREATE TABLE IF NOT EXISTS command_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_command_runs_created_at ON command_runs(created_at);
`;

export const templateDbModWithRepo = (): string => `pub mod command_run_repo;
pub mod conn;
pub mod migrate;
`;

export const templateDbMigrateWithCommandRuns = (): string => `use std::path::PathBuf;

use rusqlite::{params, Connection};

use crate::db::conn::open_connection;
use crate::errors::AppError;

const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../migrations/0001_init.sql")),
    (2, include_str!("../../migrations/0002_tables.sql")),
    (3, include_str!("../../migrations/0003_command_runs.sql")),
];

pub fn migrate_on_startup(app: &tauri::AppHandle) -> Result<(), AppError> {
    let _ = migrate(app)?;
    Ok(())
}

pub fn migrate(app: &tauri::AppHandle) -> Result<(i64, PathBuf), AppError> {
    let (mut conn, db_path) = open_connection(app)?;
    apply_migrations(&mut conn)?;
    let schema_version = current_schema_version(&conn)?;
    Ok((schema_version, db_path))
}

fn apply_migrations(conn: &mut Connection) -> Result<(), AppError> {
    let tx = conn.transaction()?;

    tx.execute_batch(include_str!("../../migrations/0001_init.sql"))?;

    for (version, sql) in MIGRATIONS {
        let exists: i64 = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
            params![version],
            |row| row.get(0),
        )?;

        if exists == 0 {
            tx.execute_batch(sql)?;
            tx.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES(?1, datetime('now'))",
                params![version],
            )?;
        }
    }

    tx.commit()?;
    Ok(())
}

fn current_schema_version(conn: &Connection) -> Result<i64, AppError> {
    let version = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;

    Ok(version)
}
`;

export const templateCommandRunModel = (): string => `use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct CommandRun {
    pub id: i64,
    pub command_name: String,
    pub input_json: String,
    pub output_json: String,
    pub created_at: String,
}
`;

export const templateModelsMod = (): string => `pub mod command_run;
pub mod generated;
`;

export const templateModelsGeneratedMod = (defs: CommandDef[]): string => {
  const lines = defs.map((def) => `pub mod ${def.moduleName};`);
  return `${lines.join("\n")}\n`;
};

export const templateModelFile = (def: CommandDef): string => {
  const inputBody = def.inputFields.length
    ? def.inputFields.map((field) => rustFieldLine(field)).join("\n")
    : "    #[serde(flatten)]\n    pub extra: serde_json::Map<String, serde_json::Value>,";

  const outputBody = def.outputFields.length
    ? def.outputFields.map((field) => rustFieldLine(field)).join("\n")
    : "    pub ok: bool,\n    pub message: String,";

  return `use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct ${def.inputStruct} {
${inputBody}
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ${def.outputStruct} {
${outputBody}
}
`;
};

export const templateCommandRunRepo = (): string => `use rusqlite::params;

use crate::db::conn::open_connection;
use crate::errors::AppError;
use crate::models::command_run::CommandRun;

pub fn insert_command_run(
    app: &tauri::AppHandle,
    command_name: &str,
    input_json: &str,
    output_json: &str,
) -> Result<(), AppError> {
    let (conn, _) = open_connection(app)?;

    conn.execute(
        "INSERT INTO command_runs(command_name, input_json, output_json, created_at) VALUES(?1, ?2, ?3, datetime('now'))",
        params![command_name, input_json, output_json],
    )?;

    Ok(())
}

pub fn list_command_runs(app: &tauri::AppHandle, limit: i64) -> Result<Vec<CommandRun>, AppError> {
    let (conn, _) = open_connection(app)?;
    let mut stmt = conn.prepare(
        "SELECT id, command_name, input_json, output_json, created_at
         FROM command_runs
         ORDER BY id DESC
         LIMIT ?1",
    )?;

    let rows = stmt.query_map(params![limit], |row| {
        Ok(CommandRun {
            id: row.get(0)?,
            command_name: row.get(1)?,
            input_json: row.get(2)?,
            output_json: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }

    Ok(result)
}
`;

export const templateServicesMod = (): string => `pub mod command_run_service;
pub mod generated;
`;

export const templateGeneratedServicesMod = (defs: CommandDef[]): string => {
  const lines = defs.map((def) => `pub mod ${def.moduleName};`);
  return `${lines.join("\n")}\n`;
};

export const templateCommandRunService = (): string => `use serde::Serialize;

use crate::db::command_run_repo;
use crate::errors::AppError;
use crate::models::command_run::CommandRun;

pub fn record_run<TInput, TOutput>(
    app: &tauri::AppHandle,
    command_name: &str,
    input: &TInput,
    output: &TOutput,
) -> Result<(), AppError>
where
    TInput: Serialize,
    TOutput: Serialize,
{
    let input_json = serde_json::to_string(input)
        .map_err(|err| AppError::Internal(format!("failed to serialize input: {err}")))?;
    let output_json = serde_json::to_string(output)
        .map_err(|err| AppError::Internal(format!("failed to serialize output: {err}")))?;

    command_run_repo::insert_command_run(app, command_name, &input_json, &output_json)
}

pub fn list_runs(app: &tauri::AppHandle, limit: i64) -> Result<Vec<CommandRun>, AppError> {
    command_run_repo::list_command_runs(app, limit)
}
`;

export const templateGeneratedServiceFile = (def: CommandDef): string => {
  const initLines = def.outputFields.length
    ? def.outputFields.map((field) => `        ${field.rustIdent}: ${rustOutputDefault(field)},`).join("\n")
    : '        ok: true,\n        message: "ok".to_string(),';

  return `use crate::errors::AppError;
use crate::models::generated::${def.moduleName}::{${def.inputStruct}, ${def.outputStruct}};
use crate::services::command_run_service;

pub async fn ${def.serviceFnName}(app: &tauri::AppHandle, input: ${def.inputStruct}) -> Result<${def.outputStruct}, AppError> {
    let output = ${def.outputStruct} {
${initLines}
    };

    command_run_service::record_run(app, "${escapeRust(def.originalName)}", &input, &output)?;
    Ok(output)
}
`;
};

export const templateGeneratedCommandsMod = (defs: CommandDef[]): string => {
  const lines = defs.map((def) => `pub mod ${def.moduleName};`);
  return `${lines.join("\n")}\n`;
};

export const templateGeneratedCommandFile = (def: CommandDef): string => `use crate::api_response::ApiResponse;
use crate::models::generated::${def.moduleName}::{${def.inputStruct}, ${def.outputStruct}};
use crate::services::generated::${def.moduleName}::${def.serviceFnName};

#[tauri::command]
pub async fn ${def.invokeName}(app: tauri::AppHandle, input: ${def.inputStruct}) -> ApiResponse<${def.outputStruct}> {
    match ${def.serviceFnName}(&app, input).await {
        Ok(output) => ApiResponse::success(output),
        Err(err) => ApiResponse::failure(err.into()),
    }
}
`;

export const templateCommandsModWithGenerated = (): string => `pub mod db;
pub mod generated;
pub mod ping;
`;

export const templateDbCommandWithRuns = (): string => `use serde::Serialize;

use crate::api_response::ApiResponse;
use crate::db::migrate;
use crate::models::command_run::CommandRun;
use crate::services::command_run_service;

#[derive(Serialize)]
pub struct DbHealth {
    pub schema_version: i64,
    pub db_path: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[tauri::command]
pub async fn db_health_check(app: tauri::AppHandle) -> ApiResponse<DbHealth> {
    match migrate::migrate(&app) {
        Ok((schema_version, db_path)) => ApiResponse::success(DbHealth {
            schema_version,
            db_path: db_path.to_string_lossy().to_string(),
            ok: true,
            message: Some("database ready".to_string()),
        }),
        Err(err) => ApiResponse::failure(err.into()),
    }
}

#[tauri::command]
pub async fn list_command_runs(app: tauri::AppHandle, limit: Option<i64>) -> ApiResponse<Vec<CommandRun>> {
    match command_run_service::list_runs(&app, limit.unwrap_or(5)) {
        Ok(runs) => ApiResponse::success(runs),
        Err(err) => ApiResponse::failure(err.into()),
    }
}
`;

export const templateRustLibWithCommands = (defs: CommandDef[]): string => {
  const generatedHandlers = defs.map((def) => `commands::generated::${def.moduleName}::${def.invokeName}`).join(", ");
  const handlers =
    generatedHandlers.length > 0
      ? `commands::ping::ping, commands::db::db_health_check, commands::db::list_command_runs, ${generatedHandlers}`
      : "commands::ping::ping, commands::db::db_health_check, commands::db::list_command_runs";

  return `mod api_response;
mod commands;
mod db;
mod errors;
mod models;
mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            db::migrate::migrate_on_startup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![${handlers}])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
`;
};

const buildTsTypes = (def: CommandDef): string => {
  const inputFields = def.inputFields
    .map((field) => `  ${JSON.stringify(field.name)}${field.specType.optional ? "?" : ""}: ${tsTypeExpr(field)};`)
    .join("\n");

  const outputFields =
    def.outputFields.length > 0
      ? def.outputFields
          .map((field) => `  ${JSON.stringify(field.name)}${field.specType.optional ? "?" : ""}: ${tsTypeExpr(field)};`)
          .join("\n")
      : "  \"ok\": boolean;\n  \"message\": string;";

  return `export type ${def.inputStruct} = {
${inputFields || "  [key: string]: unknown;"}
};

export type ${def.outputStruct} = {
${outputFields}
};
`;
};

const buildGeneratedCommandMeta = (def: CommandDef): string => {
  const inputMeta = def.inputFields
    .map(
      (field) =>
        `      { name: ${JSON.stringify(field.name)}, kind: ${JSON.stringify(field.specType.kind)}, optional: ${
          field.specType.optional
        }, type: ${JSON.stringify(field.specType.raw)} }`
    )
    .join(",\n");

  return `  {
    name: ${JSON.stringify(def.originalName)},
    invokeName: ${JSON.stringify(def.invokeName)},
    input: [
${inputMeta}
    ]
  }`;
};

const buildCommandSchemaMeta = (def: CommandDef): string => {
  const inputRows = def.inputFields
    .map((field) => `      ${JSON.stringify(field.name)}: ${JSON.stringify(field.specType.raw)}`)
    .join(",\n");
  const outputRows = def.outputFields
    .map((field) => `      ${JSON.stringify(field.name)}: ${JSON.stringify(field.specType.raw)}`)
    .join(",\n");

  return `  {
    name: ${JSON.stringify(def.invokeName)},
    input: {
${inputRows}
    },
    output: {
${outputRows}
    }
  }`;
};

const buildTsCall = (def: CommandDef): string => `export const call_${def.invokeName} = async (input: ${def.inputStruct}): Promise<${def.outputStruct}> => {
  return invokeCommand<${def.outputStruct}>(${JSON.stringify(def.invokeName)}, { input });
};
`;

const buildTsSwitchCase = (def: CommandDef): string => `    case ${JSON.stringify(def.invokeName)}:
      return call_${def.invokeName}(input as ${def.inputStruct});`;

export const templateTsGeneratedCommandsApi = (defs: CommandDef[]): string => {
  const typeBlocks = defs.map((def) => buildTsTypes(def)).join("\n");
  const callBlocks = defs.map((def) => buildTsCall(def)).join("\n");
  const metaBlocks = defs.map((def) => buildGeneratedCommandMeta(def)).join(",\n");
  const schemaMetaBlocks = defs.map((def) => buildCommandSchemaMeta(def)).join(",\n");
  const switchCases = defs.map((def) => buildTsSwitchCase(def)).join("\n");

  return `import { invokeCommand } from "../tauri";

export type GeneratedCommandField = {
  name: string;
  kind: "string" | "boolean" | "number" | "json";
  optional: boolean;
  type: string;
};

export type GeneratedCommandMeta = {
  name: string;
  invokeName: string;
  input: GeneratedCommandField[];
};

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; detail?: string } };

export type CommandMeta = {
  name: string;
  input: Record<string, string>;
  output: Record<string, string>;
};

${typeBlocks}

${callBlocks}

export const listCommandRuns = async (limit = 5): Promise<unknown[]> => {
  return invokeCommand<unknown[]>("list_command_runs", { limit });
};

export const generatedCommands: GeneratedCommandMeta[] = [
${metaBlocks}
];

export const commandMetas: CommandMeta[] = [
${schemaMetaBlocks}
];

export const runGeneratedCommand = async (invokeName: string, input: Record<string, unknown>): Promise<unknown> => {
  switch (invokeName) {
${switchCases}
    default:
      throw new Error("Unknown command: " + invokeName);
  }
};

export const callCommand = async (name: string, payload: Record<string, unknown>): Promise<ApiResponse<unknown>> => {
  try {
    const data = await runGeneratedCommand(name, payload);
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      ok: false,
      error: {
        code: "COMMAND_INVOKE_ERROR",
        message
      }
    };
  }
};
`;
};

export const templateCommandsDemoApp = (): string => `<script lang="ts">
  import { invokeCommand } from "./lib/api/tauri";
  import { generatedCommands, listCommandRuns, runGeneratedCommand, type GeneratedCommandMeta } from "./lib/api/generated/commands";

  type DbHealth = {
    schema_version: number;
    db_path: string;
    ok: boolean;
    message?: string;
  };

  let pingResult = "";
  let pingError = "";
  let pingLoading = false;

  let dbMessage = "";
  let dbError = "";
  let dbLoading = false;

  let selectedInvokeName = generatedCommands[0]?.invokeName ?? "";
  let commandResult = "";
  let commandError = "";
  let commandLoading = false;

  let runsResult = "";
  let runsError = "";
  let runsLoading = false;

  let formValues: Record<string, unknown> = {};

  const selectedCommand = (): GeneratedCommandMeta | undefined =>
    generatedCommands.find((command) => command.invokeName === selectedInvokeName);

  const resetForm = () => {
    formValues = {};
    const command = selectedCommand();
    if (!command) return;

    for (const field of command.input) {
      if (field.kind === "boolean") {
        formValues[field.name] = false;
      } else {
        formValues[field.name] = "";
      }
    }
  };

  resetForm();

  const ping = async () => {
    pingLoading = true;
    pingError = "";
    pingResult = "";

    try {
      pingResult = await invokeCommand<string>("ping");
    } catch (err) {
      pingError = err instanceof Error ? err.message : "Unknown error";
    } finally {
      pingLoading = false;
    }
  };

  const dbHealthCheck = async () => {
    dbLoading = true;
    dbError = "";
    dbMessage = "";

    try {
      const health = await invokeCommand<DbHealth>("db_health_check");
      dbMessage =
        "ok=" +
        String(health.ok) +
        ", schema_version=" +
        String(health.schema_version) +
        ", db_path=" +
        health.db_path +
        (health.message ? ", message=" + health.message : "");
    } catch (err) {
      dbError = err instanceof Error ? err.message : "Unknown error";
    } finally {
      dbLoading = false;
    }
  };

  const parseInputValue = (kind: string, value: unknown): unknown => {
    if (kind === "boolean") {
      return Boolean(value);
    }

    if (kind === "number") {
      if (typeof value === "number") return value;
      const parsed = Number(String(value));
      return Number.isNaN(parsed) ? 0 : parsed;
    }

    if (kind === "json") {
      if (typeof value === "string" && value.trim().length > 0) {
        return JSON.parse(value);
      }
      return {};
    }

    return typeof value === "string" ? value : String(value ?? "");
  };

  const runCommand = async () => {
    commandLoading = true;
    commandError = "";
    commandResult = "";

    try {
      const command = selectedCommand();
      if (!command) {
        throw new Error("No generated command available");
      }

      const payload: Record<string, unknown> = {};
      for (const field of command.input) {
        const rawValue = formValues[field.name];
        if (field.optional && (rawValue === "" || rawValue === undefined || rawValue === null)) {
          continue;
        }
        payload[field.name] = parseInputValue(field.kind, rawValue);
      }

      const result = await runGeneratedCommand(command.invokeName, payload);
      commandResult = JSON.stringify(result, null, 2);
    } catch (err) {
      commandError = err instanceof Error ? err.message : "Unknown error";
    } finally {
      commandLoading = false;
    }
  };

  const loadRuns = async () => {
    runsLoading = true;
    runsError = "";
    runsResult = "";

    try {
      const runs = await listCommandRuns(5);
      runsResult = JSON.stringify(runs, null, 2);
    } catch (err) {
      runsError = err instanceof Error ? err.message : "Unknown error";
    } finally {
      runsLoading = false;
    }
  };
</script>

<main>
  <h1>Tauri Commands Demo</h1>

  <section>
    <button on:click={ping} disabled={pingLoading}>{pingLoading ? "Pinging..." : "Ping"}</button>
    {#if pingResult}
      <p>Ping: {pingResult}</p>
    {/if}
    {#if pingError}
      <p>Error: {pingError}</p>
    {/if}
  </section>

  <section>
    <button on:click={dbHealthCheck} disabled={dbLoading}>{dbLoading ? "Checking..." : "DB Health Check"}</button>
    {#if dbMessage}
      <p>DB: {dbMessage}</p>
    {/if}
    {#if dbError}
      <p>DB Error: {dbError}</p>
    {/if}
  </section>

  <section>
    <h2>Commands Demo</h2>
    {#if generatedCommands.length === 0}
      <p>No generated commands found in spec.</p>
    {:else}
      <label>
        Command
        <select bind:value={selectedInvokeName} on:change={resetForm}>
          {#each generatedCommands as command}
            <option value={command.invokeName}>{command.name}</option>
          {/each}
        </select>
      </label>

      {#if selectedCommand()}
        {#each selectedCommand()!.input as field}
          <div class="field">
            <label>{field.name} ({field.type})</label>
            {#if field.kind === "boolean"}
              <input
                type="checkbox"
                checked={Boolean(formValues[field.name])}
                on:change={(event) => {
                  const target = event.currentTarget as HTMLInputElement;
                  formValues = { ...formValues, [field.name]: target.checked };
                }}
              />
            {:else if field.kind === "json"}
              <textarea
                value={String(formValues[field.name] ?? "")}
                on:input={(event) => {
                  const target = event.currentTarget as HTMLTextAreaElement;
                  formValues = { ...formValues, [field.name]: target.value };
                }}
              ></textarea>
            {:else}
              <input
                type={field.kind === "number" ? "number" : "text"}
                value={String(formValues[field.name] ?? "")}
                on:input={(event) => {
                  const target = event.currentTarget as HTMLInputElement;
                  formValues = { ...formValues, [field.name]: target.value };
                }}
              />
            {/if}
          </div>
        {/each}
      {/if}

      <button on:click={runCommand} disabled={commandLoading}>
        {commandLoading ? "Running..." : "Run Command"}
      </button>

      {#if commandResult}
        <pre>{commandResult}</pre>
      {/if}
      {#if commandError}
        <p>Command Error: {commandError}</p>
      {/if}

      <button on:click={loadRuns} disabled={runsLoading}>{runsLoading ? "Loading..." : "List Runs"}</button>
      {#if runsResult}
        <pre>{runsResult}</pre>
      {/if}
      {#if runsError}
        <p>Runs Error: {runsError}</p>
      {/if}
    {/if}
  </section>
</main>

<style>
  main {
    font-family: sans-serif;
    margin: 2rem;
    display: grid;
    gap: 1rem;
  }

  section {
    border: 1px solid #ddd;
    padding: 1rem;
  }

  .field {
    margin: 0.5rem 0;
    display: grid;
    gap: 0.35rem;
  }

  textarea {
    min-height: 88px;
  }

  pre {
    background: #f5f5f5;
    padding: 0.75rem;
    overflow-x: auto;
  }
</style>
`;

export const templateCommandsFiles = (ir: SpecIR): Record<string, string> => {
  const defs = buildCommandDefs(ir);

  const files: Record<string, string> = {
    "src-tauri/migrations/0003_command_runs.sql": templateCommandRunsMigration(),
    "src-tauri/src/db/mod.rs": templateDbModWithRepo(),
    "src-tauri/src/db/migrate.rs": templateDbMigrateWithCommandRuns(),
    "src-tauri/src/db/command_run_repo.rs": templateCommandRunRepo(),
    "src-tauri/src/models/mod.rs": templateModelsMod(),
    "src-tauri/src/models/command_run.rs": templateCommandRunModel(),
    "src-tauri/src/models/generated/mod.rs": templateModelsGeneratedMod(defs),
    "src-tauri/src/services/mod.rs": templateServicesMod(),
    "src-tauri/src/services/command_run_service.rs": templateCommandRunService(),
    "src-tauri/src/services/generated/mod.rs": templateGeneratedServicesMod(defs),
    "src-tauri/src/commands/mod.rs": templateCommandsModWithGenerated(),
    "src-tauri/src/commands/db.rs": templateDbCommandWithRuns(),
    "src-tauri/src/commands/generated/mod.rs": templateGeneratedCommandsMod(defs),
    "src-tauri/src/lib.rs": templateRustLibWithCommands(defs),
    "src/lib/api/generated/commands.ts": templateTsGeneratedCommandsApi(defs),
    "src/App.svelte": templateCommandsDemoApp()
  };

  defs.forEach((def) => {
    files[`src-tauri/src/models/generated/${def.moduleName}.rs`] = templateModelFile(def);
    files[`src-tauri/src/services/generated/${def.moduleName}.rs`] = templateGeneratedServiceFile(def);
    files[`src-tauri/src/commands/generated/${def.moduleName}.rs`] = templateGeneratedCommandFile(def);
  });

  return files;
};
