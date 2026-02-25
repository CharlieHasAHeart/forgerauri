import type { SpecIR } from "../../spec/schema.js";
import { generateTablesMigrationSql } from "./sql.js";

export const templateMigrationInitSql = (): string => `CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);
`;

export const templateMigrationTablesSql = (ir: SpecIR): string => generateTablesMigrationSql(ir);

export const templateCargoTomlWithDb = (appName: string): string => {
  const slug = appName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "app";

  return `[package]
name = "${slug.replace(/-/g, "_")}_desktop"
version = "0.1.0"
edition = "2021"

[lib]
name = "app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.0.1" }

[dependencies]
rusqlite = { version = "0.32", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
tauri = { version = "2.8.5", features = [] }
`;
};

export const templateRustDbMod = (): string => `pub mod conn;
pub mod migrate;
`;

export const templateRustDbConn = (): string => `use std::fs;
use std::path::PathBuf;

use rusqlite::Connection;
use tauri::Manager;

use crate::errors::AppError;

pub fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let mut app_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| AppError::Internal(format!("failed to resolve app data dir: {err}")))?;

    fs::create_dir_all(&app_dir)?;
    app_dir.push("app.sqlite3");
    Ok(app_dir)
}

pub fn open_connection(app: &tauri::AppHandle) -> Result<(Connection, PathBuf), AppError> {
    let path = database_path(app)?;
    let conn = Connection::open(&path)?;
    Ok((conn, path))
}
`;

export const templateRustDbMigrate = (): string => `use std::fs;
use std::path::PathBuf;

use rusqlite::{params, Connection};

use crate::db::conn::open_connection;
use crate::errors::AppError;

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

    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            version INTEGER NOT NULL,
            applied_at TEXT NOT NULL
        )",
    )?;

    for (name, version, sql) in load_migrations()? {
        let exists: i64 = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name = ?1)",
            params![name],
            |row| row.get(0),
        )?;

        if exists == 0 {
            tx.execute_batch(&sql)?;
            tx.execute(
                "INSERT INTO schema_migrations(name, version, applied_at) VALUES(?1, ?2, datetime('now'))",
                params![name, version],
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

fn load_migrations() -> Result<Vec<(String, i64, String)>, AppError> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("migrations");
    let mut files: Vec<PathBuf> = fs::read_dir(dir)?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("sql"))
        .collect();

    files.sort_by(|left, right| left.file_name().cmp(&right.file_name()));

    let mut migrations = Vec::new();
    for path in files {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| AppError::Internal("invalid migration filename".to_string()))?
            .to_string();
        let version = parse_version(&name);
        let sql = fs::read_to_string(&path)?;
        migrations.push((name, version, sql));
    }

    Ok(migrations)
}

fn parse_version(name: &str) -> i64 {
    let digits: String = name.chars().take_while(|ch| ch.is_ascii_digit()).collect();
    digits.parse::<i64>().unwrap_or(0)
}
`;

export const templateRustDbCommand = (): string => `use serde::Serialize;

use crate::api_response::ApiResponse;
use crate::db::migrate;

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
`;

export const templateRustCommandsModWithDb = (): string => `pub mod db;
pub mod ping;
`;

export const templateRustLibWithDb = (): string => `mod api_response;
mod commands;
mod db;
mod errors;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            db::migrate::migrate_on_startup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::ping::ping, commands::db::db_health_check])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
`;

export const templateRustErrorsWithDb = (): string => `use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Internal(String),
}

#[derive(Debug, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl ApiError {
    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            code: "INTERNAL_ERROR".to_string(),
            message: "Internal error".to_string(),
            detail: Some(message.into()),
        }
    }
}

impl From<AppError> for ApiError {
    fn from(value: AppError) -> Self {
        match value {
            AppError::Db(err) => Self {
                code: "DB_ERROR".to_string(),
                message: "Database error".to_string(),
                detail: Some(err.to_string()),
            },
            AppError::Io(err) => Self {
                code: "IO_ERROR".to_string(),
                message: "I/O error".to_string(),
                detail: Some(err.to_string()),
            },
            AppError::Internal(message) => Self {
                code: "INTERNAL_ERROR".to_string(),
                message: "Internal error".to_string(),
                detail: Some(message),
            },
        }
    }
}
`;

export const templateSvelteAppWithDb = (): string => `<script lang="ts">
  import { invokeCommand } from "./lib/api/tauri";

  let pingResult = "";
  let pingError = "";
  let pingLoading = false;

  let dbMessage = "";
  let dbError = "";
  let dbLoading = false;

  type DbHealth = {
    schema_version: number;
    db_path: string;
    ok: boolean;
    message?: string;
  };

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
      dbMessage = \`ok=\${health.ok}, schema_version=\${health.schema_version}, db_path=\${health.db_path}\${health.message ? \`, message=\${health.message}\` : ""}\`;
    } catch (err) {
      dbError = err instanceof Error ? err.message : "Unknown error";
    } finally {
      dbLoading = false;
    }
  };
</script>

<main>
  <h1>Tauri Ping + DB Demo</h1>

  <section>
    <button on:click={ping} disabled={pingLoading}>{pingLoading ? "Pinging..." : "Ping"}</button>
    {#if pingResult}
      <p data-testid="result">Result: {pingResult}</p>
    {/if}
    {#if pingError}
      <p data-testid="error">Error: {pingError}</p>
    {/if}
  </section>

  <section>
    <button on:click={dbHealthCheck} disabled={dbLoading}>{dbLoading ? "Checking..." : "DB Health Check"}</button>
    {#if dbMessage}
      <p data-testid="db-health">DB: {dbMessage}</p>
    {/if}
    {#if dbError}
      <p data-testid="db-error">DB Error: {dbError}</p>
    {/if}
  </section>
</main>

<style>
  main {
    font-family: sans-serif;
    margin: 2rem;
  }

  section {
    margin-top: 1rem;
  }

  button {
    padding: 0.5rem 1rem;
  }
</style>
`;

export const templateDbFiles = (ir: SpecIR): Record<string, string> => ({
  "src-tauri/migrations/0001_init.sql": templateMigrationInitSql(),
  "src-tauri/migrations/0002_tables.sql": templateMigrationTablesSql(ir),
  "src-tauri/Cargo.toml": templateCargoTomlWithDb(ir.app.name),
  "src-tauri/src/lib.rs": templateRustLibWithDb(),
  "src-tauri/src/errors.rs": templateRustErrorsWithDb(),
  "src-tauri/src/db/mod.rs": templateRustDbMod(),
  "src-tauri/src/db/conn.rs": templateRustDbConn(),
  "src-tauri/src/db/migrate.rs": templateRustDbMigrate(),
  "src-tauri/src/commands/mod.rs": templateRustCommandsModWithDb(),
  "src-tauri/src/commands/db.rs": templateRustDbCommand(),
  "src/App.svelte": templateSvelteAppWithDb()
});
