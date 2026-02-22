import type { SpecIR } from "../../spec/schema.js";
import { parseSpecType, toPascalCase, toRustIdent, toSnakeCase } from "../commands/typesMap.js";
import { resolveBusinessTargets } from "./resolveDomain.js";

type FieldDef = {
  original: string;
  rustIdent: string;
  rawType: string;
  parsed: ReturnType<typeof parseSpecType>;
};

type CommandMeta = {
  name: string;
  input: Record<string, string>;
  output: Record<string, string>;
};

type CommandDef = {
  name: string;
  inputStruct: string;
  outputStruct: string;
  inputFields: FieldDef[];
  outputFields: FieldDef[];
  inputDict: Record<string, string>;
  outputDict: Record<string, string>;
};

const asStringDict = (value: Record<string, unknown> | undefined): Record<string, string> => {
  const dict = value ?? {};
  const out: Record<string, string> = {};
  Object.entries(dict)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([key, raw]) => {
      out[key] = typeof raw === "string" ? raw : "json";
    });
  return out;
};

const toFields = (dict: Record<string, string>): FieldDef[] =>
  Object.entries(dict)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, rawType]) => ({
      original: name,
      rustIdent: toRustIdent(name),
      rawType,
      parsed: parseSpecType(rawType)
    }));

const findCommand = (ir: SpecIR, commandName: string | null): CommandDef | null => {
  if (!commandName) return null;

  const found = ir.rust_commands.find((cmd) => toSnakeCase(cmd.name) === commandName);
  if (!found) return null;

  const inputDict = asStringDict(found.input as Record<string, unknown>);
  const outputDict = asStringDict(found.output as Record<string, unknown>);

  return {
    name: commandName,
    inputStruct: `${toPascalCase(commandName)}Input`,
    outputStruct: `${toPascalCase(commandName)}Output`,
    inputFields: toFields(inputDict),
    outputFields: toFields(outputDict),
    inputDict,
    outputDict
  };
};

const hasOptionalToolType = (command: CommandDef | null): boolean => {
  if (!command) return false;
  const type = command.inputDict.tool_type;
  return typeof type === "string" ? type.trim().toLowerCase().endsWith("?") : false;
};

const rustDefaultForField = (field: FieldDef): string => {
  if (field.parsed.optional) {
    return "None";
  }

  const key = field.rustIdent.toLowerCase();
  if (key === "ok") return "true";
  if (key === "message") return '"ok".to_string()';

  return field.parsed.rustDefault;
};

const buildInternalMetas = (lint: CommandDef | null, apply: CommandDef | null): CommandMeta[] => {
  const metas: CommandMeta[] = [];

  if (lint) {
    metas.push({
      name: "list_lint_runs",
      input: { limit: "int?" },
      output: { runs: "json", total: "int?" }
    });
  }

  if (apply) {
    metas.push({
      name: "list_fix_runs",
      input: { limit: "int?" },
      output: { runs: "json", total: "int?" }
    });
  }

  return metas;
};

const buildAllMetas = (ir: SpecIR, lint: CommandDef | null, apply: CommandDef | null): CommandMeta[] => {
  const base = [...ir.rust_commands]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((cmd) => {
      const name = toSnakeCase(cmd.name);
      return {
        name,
        input: asStringDict(cmd.input as Record<string, unknown>),
        output: asStringDict(cmd.output as Record<string, unknown>)
      };
    });

  return [...base, ...buildInternalMetas(lint, apply)];
};

export const templateBusinessMigration = (lint: CommandDef | null, apply: CommandDef | null): string => {
  const lintToolNullable = hasOptionalToolType(lint) ? "NULL" : "NOT NULL";
  const fixToolNullable = hasOptionalToolType(apply) ? "NULL" : "NOT NULL";

  return `CREATE TABLE IF NOT EXISTS lint_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  tool_type TEXT ${lintToolNullable},
  valid INTEGER NOT NULL,
  diagnostics_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fix_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  tool_type TEXT ${fixToolNullable},
  changed INTEGER NOT NULL,
  diff TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;
};

export const templateDbMigrateWithBusiness = (): string => `use std::path::PathBuf;

use rusqlite::{params, Connection};

use crate::db::conn::open_connection;
use crate::errors::AppError;

const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../migrations/0001_init.sql")),
    (2, include_str!("../../migrations/0002_tables.sql")),
    (3, include_str!("../../migrations/0003_command_runs.sql")),
    (4, include_str!("../../migrations/0004_business.sql")),
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

export const templateDbModWithBusiness = (): string => `pub mod command_run_repo;
pub mod conn;
pub mod fix_repo;
pub mod lint_repo;
pub mod migrate;
`;

export const templateLintRepo = (): string => `use rusqlite::params;
use serde::Serialize;

use crate::db::conn::open_connection;
use crate::errors::AppError;

#[derive(Debug, Serialize)]
pub struct LintRunRow {
    pub id: i64,
    pub file_path: String,
    pub tool_type: Option<String>,
    pub valid: bool,
    pub diagnostics_json: String,
    pub created_at: String,
}

pub fn insert_lint_run(
    app: &tauri::AppHandle,
    file_path: &str,
    tool_type: Option<&str>,
    valid: bool,
    diagnostics_json: &str,
    created_at: &str,
) -> Result<i64, AppError> {
    let (conn, _) = open_connection(app)?;

    conn.execute(
        "INSERT INTO lint_runs(file_path, tool_type, valid, diagnostics_json, created_at) VALUES(?1, ?2, ?3, ?4, ?5)",
        params![file_path, tool_type, if valid { 1 } else { 0 }, diagnostics_json, created_at],
    )?;

    Ok(conn.last_insert_rowid())
}

pub fn list_lint_runs(app: &tauri::AppHandle, limit: i64) -> Result<Vec<LintRunRow>, AppError> {
    let (conn, _) = open_connection(app)?;
    let mut stmt = conn.prepare(
        "SELECT id, file_path, tool_type, valid, diagnostics_json, created_at
         FROM lint_runs
         ORDER BY id DESC
         LIMIT ?1",
    )?;

    let rows = stmt.query_map(params![limit], |row| {
        Ok(LintRunRow {
            id: row.get(0)?,
            file_path: row.get(1)?,
            tool_type: row.get(2)?,
            valid: row.get::<_, i64>(3)? != 0,
            diagnostics_json: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }

    Ok(result)
}
`;

export const templateFixRepo = (): string => `use rusqlite::params;
use serde::Serialize;

use crate::db::conn::open_connection;
use crate::errors::AppError;

#[derive(Debug, Serialize)]
pub struct FixRunRow {
    pub id: i64,
    pub file_path: String,
    pub tool_type: Option<String>,
    pub changed: bool,
    pub diff: String,
    pub created_at: String,
}

pub fn insert_fix_run(
    app: &tauri::AppHandle,
    file_path: &str,
    tool_type: Option<&str>,
    changed: bool,
    diff: &str,
    created_at: &str,
) -> Result<i64, AppError> {
    let (conn, _) = open_connection(app)?;

    conn.execute(
        "INSERT INTO fix_runs(file_path, tool_type, changed, diff, created_at) VALUES(?1, ?2, ?3, ?4, ?5)",
        params![file_path, tool_type, if changed { 1 } else { 0 }, diff, created_at],
    )?;

    Ok(conn.last_insert_rowid())
}

pub fn list_fix_runs(app: &tauri::AppHandle, limit: i64) -> Result<Vec<FixRunRow>, AppError> {
    let (conn, _) = open_connection(app)?;
    let mut stmt = conn.prepare(
        "SELECT id, file_path, tool_type, changed, diff, created_at
         FROM fix_runs
         ORDER BY id DESC
         LIMIT ?1",
    )?;

    let rows = stmt.query_map(params![limit], |row| {
        Ok(FixRunRow {
            id: row.get(0)?,
            file_path: row.get(1)?,
            tool_type: row.get(2)?,
            changed: row.get::<_, i64>(3)? != 0,
            diff: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }

    Ok(result)
}
`;

export const templateServicesModWithBusiness = (lint: CommandDef | null, apply: CommandDef | null): string => {
  const lines = ["pub mod command_run_service;", "pub mod generated;"];
  if (lint) lines.push("pub mod lint_service;");
  if (apply) lines.push("pub mod fix_service;");
  return `${lines.join("\n")}\n`;
};

const outputAssignments = (outputFields: FieldDef[], mode: "lint" | "apply"): string => {
  if (outputFields.length === 0) {
    return '        ok: true,\n        message: "ok".to_string(),';
  }

  return outputFields
    .map((field) => {
      const key = field.rustIdent.toLowerCase();
      if (key === "ok") return `        ${field.rustIdent}: true,`;
      if (key === "message") return `        ${field.rustIdent}: message.clone(),`;
      if (key === "created_at") return `        ${field.rustIdent}: created_at.clone(),`;
      if (key === "diagnostics" || key === "diagnostics_json") {
        return `        ${field.rustIdent}: diagnostics_value.clone(),`;
      }
      if (key === "changed") return `        ${field.rustIdent}: changed,`;
      if (key === "diff") return `        ${field.rustIdent}: diff.clone(),`;
      if (key === "valid") return `        ${field.rustIdent}: valid,`;
      return `        ${field.rustIdent}: ${rustDefaultForField(field)},`;
    })
    .join("\n");
};

const pickField = (fields: FieldDef[], candidates: string[]): FieldDef | null => {
  for (const candidate of candidates) {
    const found = fields.find((field) => field.rustIdent === candidate || field.original === candidate);
    if (found) return found;
  }
  return null;
};

export const templateLintService = (lint: CommandDef): string => {
  const fileField = pickField(lint.inputFields, ["file_path", "config_path", "path", "file"]);
  const toolField = pickField(lint.inputFields, ["tool_type", "tool"]);
  const validField = pickField(lint.inputFields, ["valid"]);
  const diagnosticsField = pickField(lint.inputFields, ["diagnostics", "diagnostics_json"]);

  const fileExpr = fileField
    ? `let file_path = input.${fileField.rustIdent}.clone();`
    : `let file_path = "unknown".to_string();\n    let mut defaulted_message = Some("field missing, defaulted".to_string());`;

  const toolExpr = toolField
    ? toolField.parsed.optional
      ? `let tool_type = input.${toolField.rustIdent}.clone();`
      : `let tool_type = Some(input.${toolField.rustIdent}.clone());`
    : `let tool_type: Option<String> = Some("generic".to_string());`;

  const validExpr = validField ? `let valid = input.${validField.rustIdent};` : "let valid = true;";
  const diagExpr = diagnosticsField
    ? `let diagnostics_value = input.${diagnosticsField.rustIdent}.clone();`
    : 'let diagnostics_value = serde_json::json!({"summary": "lint executed"});';

  const outputInit = outputAssignments(lint.outputFields, "lint");

  return `use crate::db::lint_repo;
use crate::errors::AppError;
use crate::models::generated::${lint.name}::{${lint.inputStruct}, ${lint.outputStruct}};

pub async fn run_lint(app: &tauri::AppHandle, input: ${lint.inputStruct}) -> Result<${lint.outputStruct}, AppError> {
    ${fileExpr}
    ${toolExpr}
    ${validExpr}
    ${diagExpr}

    let diagnostics_json = serde_json::to_string(&diagnostics_value)
        .map_err(|err| AppError::Internal(format!("failed to serialize diagnostics: {err}")))?;

    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());

    let _ = lint_repo::insert_lint_run(
        app,
        &file_path,
        tool_type.as_deref(),
        valid,
        &diagnostics_json,
        &created_at,
    )?;

    let mut message = "lint completed".to_string();
    if ${fileField ? "false" : "true"} {
        message.push_str(" (field missing, defaulted)");
    }

    let output = ${lint.outputStruct} {
${outputInit}
    };

    Ok(output)
}

pub fn list_lint_runs(app: &tauri::AppHandle, limit: i64) -> Result<Vec<lint_repo::LintRunRow>, AppError> {
    lint_repo::list_lint_runs(app, limit)
}
`;
};

export const templateFixService = (apply: CommandDef): string => {
  const fileField = pickField(apply.inputFields, ["file_path", "config_path", "path", "file", "target"]);
  const toolField = pickField(apply.inputFields, ["tool_type", "tool"]);
  const changedField = pickField(apply.inputFields, ["changed"]);
  const diffField = pickField(apply.inputFields, ["diff"]);

  const fileExpr = fileField ? `let file_path = input.${fileField.rustIdent}.clone();` : `let file_path = "unknown".to_string();`;
  const toolExpr = toolField
    ? toolField.parsed.optional
      ? `let tool_type = input.${toolField.rustIdent}.clone();`
      : `let tool_type = Some(input.${toolField.rustIdent}.clone());`
    : `let tool_type: Option<String> = Some("generic".to_string());`;

  const changedExpr = changedField ? `let changed = input.${changedField.rustIdent};` : "let changed = true;";
  const diffExpr = diffField ? `let diff = input.${diffField.rustIdent}.clone();` : 'let diff = "simulated diff".to_string();';

  const outputInit = outputAssignments(apply.outputFields, "apply");

  return `use crate::db::fix_repo;
use crate::errors::AppError;
use crate::models::generated::${apply.name}::{${apply.inputStruct}, ${apply.outputStruct}};

pub async fn run_apply_fixes(app: &tauri::AppHandle, input: ${apply.inputStruct}) -> Result<${apply.outputStruct}, AppError> {
    ${fileExpr}
    ${toolExpr}
    ${changedExpr}
    ${diffExpr}

    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());

    let _ = fix_repo::insert_fix_run(app, &file_path, tool_type.as_deref(), changed, &diff, &created_at)?;

    let mut message = "apply completed".to_string();
    if ${fileField ? "false" : "true"} {
        message.push_str(" (field missing, defaulted)");
    }

    let diagnostics_value = serde_json::json!({});
    let output = ${apply.outputStruct} {
${outputInit}
    };

    Ok(output)
}

pub fn list_fix_runs(app: &tauri::AppHandle, limit: i64) -> Result<Vec<fix_repo::FixRunRow>, AppError> {
    fix_repo::list_fix_runs(app, limit)
}
`;
};

export const templateBusinessCommand = (command: CommandDef, servicePath: string, serviceFn: string): string => `use crate::api_response::ApiResponse;
use crate::models::generated::${command.name}::{${command.inputStruct}, ${command.outputStruct}};
use crate::services::${servicePath}::${serviceFn};

#[tauri::command]
pub async fn ${command.name}(app: tauri::AppHandle, input: ${command.inputStruct}) -> ApiResponse<${command.outputStruct}> {
    match ${serviceFn}(&app, input).await {
        Ok(output) => ApiResponse::success(output),
        Err(err) => ApiResponse::failure(err.into()),
    }
}
`;

export const templateListLintRunsCommand = (): string => `use serde::Deserialize;

use crate::api_response::ApiResponse;
use crate::services::lint_service;

#[derive(Debug, Deserialize)]
pub struct ListLintRunsInput {
    pub limit: Option<i64>,
}

#[tauri::command]
pub async fn list_lint_runs(app: tauri::AppHandle, input: ListLintRunsInput) -> ApiResponse<serde_json::Value> {
    match lint_service::list_lint_runs(&app, input.limit.unwrap_or(10)) {
        Ok(runs) => ApiResponse::success(serde_json::json!({
            "runs": runs,
            "total": runs.len() as i64
        })),
        Err(err) => ApiResponse::failure(err.into()),
    }
}
`;

export const templateListFixRunsCommand = (): string => `use serde::Deserialize;

use crate::api_response::ApiResponse;
use crate::services::fix_service;

#[derive(Debug, Deserialize)]
pub struct ListFixRunsInput {
    pub limit: Option<i64>,
}

#[tauri::command]
pub async fn list_fix_runs(app: tauri::AppHandle, input: ListFixRunsInput) -> ApiResponse<serde_json::Value> {
    match fix_service::list_fix_runs(&app, input.limit.unwrap_or(10)) {
        Ok(runs) => ApiResponse::success(serde_json::json!({
            "runs": runs,
            "total": runs.len() as i64
        })),
        Err(err) => ApiResponse::failure(err.into()),
    }
}
`;

export const templateGeneratedCommandsModBusiness = (
  ir: SpecIR,
  lint: CommandDef | null,
  apply: CommandDef | null
): string => {
  const modules = [...ir.rust_commands].map((cmd) => toSnakeCase(cmd.name));
  if (lint) modules.push("list_lint_runs");
  if (apply) modules.push("list_fix_runs");

  const unique = Array.from(new Set(modules)).sort((a, b) => a.localeCompare(b));
  return `${unique.map((name) => `pub mod ${name};`).join("\n")}\n`;
};

export const templateRustLibBusiness = (
  ir: SpecIR,
  lint: CommandDef | null,
  apply: CommandDef | null
): string => {
  const handlers = [
    "commands::ping::ping",
    "commands::db::db_health_check",
    "commands::db::list_command_runs",
    ...[...ir.rust_commands].map((cmd) => {
      const name = toSnakeCase(cmd.name);
      return `commands::generated::${name}::${name}`;
    })
  ];

  if (lint) handlers.push("commands::generated::list_lint_runs::list_lint_runs");
  if (apply) handlers.push("commands::generated::list_fix_runs::list_fix_runs");

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
        .invoke_handler(tauri::generate_handler![${handlers.join(", ")}])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
`;
};

const kindFromType = (rawType: string): "string" | "boolean" | "number" | "json" => {
  const normalized = rawType.toLowerCase().replace(/\?$/, "");
  if (normalized === "boolean") return "boolean";
  if (normalized === "int" || normalized === "float") return "number";
  if (normalized === "json") return "json";
  return "string";
};

export const templateCommandsTsBusiness = (ir: SpecIR, lint: CommandDef | null, apply: CommandDef | null): string => {
  const metas = buildAllMetas(ir, lint, apply);

  const metasLiteral = metas
    .map((meta) => {
      const inputRows = Object.entries(meta.input)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, type]) => `      ${JSON.stringify(name)}: ${JSON.stringify(type)}`)
        .join(",\n");

      const outputRows = Object.entries(meta.output)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, type]) => `      ${JSON.stringify(name)}: ${JSON.stringify(type)}`)
        .join(",\n");

      return `  {
    name: ${JSON.stringify(meta.name)},
    input: {
${inputRows}
    },
    output: {
${outputRows}
    }
  }`;
    })
    .join(",\n");

  const switchCases = metas
    .map(
      (meta) => `    case ${JSON.stringify(meta.name)}:
      return invokeCommand<unknown>(${JSON.stringify(meta.name)}, { input: payload });`
    )
    .join("\n");

  const generatedRows = metas
    .map((meta) => {
      const inputRows = Object.entries(meta.input)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, type]) => {
          const optional = type.trim().toLowerCase().endsWith("?");
          return `      { name: ${JSON.stringify(name)}, kind: ${JSON.stringify(kindFromType(type))}, optional: ${optional}, type: ${
            JSON.stringify(type)
          } }`;
        })
        .join(",\n");

      return `  {
    name: ${JSON.stringify(meta.name)},
    invokeName: ${JSON.stringify(meta.name)},
    input: [
${inputRows}
    ]
  }`;
    })
    .join(",\n");

  return `import { invokeCommand } from "../tauri";

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; detail?: string } };

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

export type CommandMeta = {
  name: string;
  input: Record<string, string>;
  output: Record<string, string>;
};

export const commandMetas: CommandMeta[] = [
${metasLiteral}
];

export const generatedCommands: GeneratedCommandMeta[] = [
${generatedRows}
];

export const runGeneratedCommand = async (invokeName: string, payload: Record<string, unknown>): Promise<unknown> => {
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

export const listCommandRuns = async (limit = 5): Promise<unknown[]> => {
  return invokeCommand<unknown[]>("list_command_runs", { limit });
};
`;
};

export const templateBusinessFiles = (ir: SpecIR): Record<string, string> => {
  const targets = resolveBusinessTargets(ir);
  const lint = findCommand(ir, targets.lintCommand);
  const apply = findCommand(ir, targets.applyCommand);

  const files: Record<string, string> = {
    "src-tauri/migrations/0004_business.sql": templateBusinessMigration(lint, apply),
    "src-tauri/src/db/mod.rs": templateDbModWithBusiness(),
    "src-tauri/src/db/migrate.rs": templateDbMigrateWithBusiness(),
    "src-tauri/src/db/lint_repo.rs": templateLintRepo(),
    "src-tauri/src/db/fix_repo.rs": templateFixRepo(),
    "src-tauri/src/services/mod.rs": templateServicesModWithBusiness(lint, apply),
    "src-tauri/src/commands/generated/mod.rs": templateGeneratedCommandsModBusiness(ir, lint, apply),
    "src-tauri/src/lib.rs": templateRustLibBusiness(ir, lint, apply),
    "src/lib/api/generated/commands.ts": templateCommandsTsBusiness(ir, lint, apply)
  };

  if (lint) {
    files["src-tauri/src/services/lint_service.rs"] = templateLintService(lint);
    files[`src-tauri/src/commands/generated/${lint.name}.rs`] = templateBusinessCommand(lint, "lint_service", "run_lint");
    files["src-tauri/src/commands/generated/list_lint_runs.rs"] = templateListLintRunsCommand();
  }

  if (apply) {
    files["src-tauri/src/services/fix_service.rs"] = templateFixService(apply);
    files[`src-tauri/src/commands/generated/${apply.name}.rs`] = templateBusinessCommand(apply, "fix_service", "run_apply_fixes");
    files["src-tauri/src/commands/generated/list_fix_runs.rs"] = templateListFixRunsCommand();
  }

  return files;
};
