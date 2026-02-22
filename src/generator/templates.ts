import type { SpecIR } from "../spec/schema.js";

export const toAppSlug = (appName: string): string => {
  const slug = appName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "app";
};

const toIdentifier = (slug: string): string => {
  const clean = slug.replace(/[^a-z0-9.-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `com.forgetauri.${clean || "app"}`;
};

const escapeJson = (value: string): string => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export const templatePackageJson = (appName: string): string => `{
  "name": "${toAppSlug(appName)}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "tauri": "tauri",
    "tauri:dev": "tauri dev"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.8.0",
    "svelte": "^5.39.6"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^6.2.1",
    "@tauri-apps/cli": "^2.8.2",
    "typescript": "^5.9.3",
    "vite": "^7.1.9"
  }
}
`;

export const templateTsConfig = (): string => `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["svelte"]
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.svelte", "vite.config.ts"]
}
`;

export const templateViteConfig = (): string => `import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 1421
    },
    watch: {
      ignored: ["**/src-tauri/**"]
    }
  }
});
`;

export const templateIndexHtml = (appName: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeJson(appName)}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

export const templateMainTs = (): string => `import { mount } from "svelte";
import App from "./App.svelte";

const app = mount(App, {
  target: document.getElementById("app")!
});

export default app;
`;

export const templateTauriApi = (): string => `import { invoke } from "@tauri-apps/api/core";

type ApiError = {
  code: string;
  message: string;
  detail?: string;
};

type ApiSuccess<T> = {
  ok: true;
  data: T;
};

type ApiFailure = {
  ok: false;
  error: ApiError;
};

type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

const isApiResponse = <T>(value: unknown): value is ApiResponse<T> => {
  if (!value || typeof value !== "object") {
    return false;
  }

  return "ok" in value;
};

export const invokeCommand = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  const response = await invoke<unknown>(command, args);

  if (!isApiResponse<T>(response)) {
    throw new Error("Invalid command response shape");
  }

  if (response.ok) {
    return response.data;
  }

  throw new Error(response.error.detail ? \`\${response.error.message}: \${response.error.detail}\` : response.error.message);
};
`;

export const templateAppSvelte = (): string => `<script lang="ts">
  import { invokeCommand } from "./lib/api/tauri";

  let result = "";
  let error = "";
  let loading = false;

  const ping = async () => {
    loading = true;
    error = "";
    result = "";

    try {
      result = await invokeCommand<string>("ping");
    } catch (err) {
      error = err instanceof Error ? err.message : "Unknown error";
    } finally {
      loading = false;
    }
  };
</script>

<main>
  <h1>Tauri Ping Demo</h1>
  <button on:click={ping} disabled={loading}>{loading ? "Pinging..." : "Ping"}</button>

  {#if result}
    <p data-testid="result">Result: {result}</p>
  {/if}

  {#if error}
    <p data-testid="error">Error: {error}</p>
  {/if}
</main>

<style>
  main {
    font-family: sans-serif;
    margin: 2rem;
  }

  button {
    margin-top: 1rem;
    padding: 0.5rem 1rem;
  }
</style>
`;

export const templateCargoToml = (appName: string): string => `[package]
name = "${toAppSlug(appName).replace(/-/g, "_")}_desktop"
version = "0.1.0"
edition = "2021"

[lib]
name = "app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.0.1" }

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
tauri = { version = "2.8.5", features = [] }
`;

export const templateBuildRs = (): string => `fn main() {
    tauri_build::build()
}
`;

export const templateTauriConf = (appName: string): string => `{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "${escapeJson(appName)}",
  "version": "0.1.0",
  "identifier": "${toIdentifier(toAppSlug(appName))}",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "${escapeJson(appName)}",
        "width": 900,
        "height": 640
      }
    ]
  },
  "bundle": {
    "active": false,
    "targets": "all"
  }
}
`;

export const templateCapabilityDefault = (): string => `{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability",
  "windows": ["main"],
  "permissions": ["core:default"]
}
`;

export const templateRustLib = (): string => `mod api_response;
mod commands;
mod errors;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::ping::ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
`;

export const templateRustEntry = (): string => `fn main() {
    app_lib::run();
}
`;

export const templateRustCommandsMod = (): string => `pub mod ping;
`;

export const templateRustPing = (ir: SpecIR): string => `use crate::api_response::ApiResponse;

#[tauri::command]
pub fn ping() -> ApiResponse<String> {
    ApiResponse::success(format!("pong from ${ir.app.name.replace(/"/g, '\\"')}"))
}
`;

export const templateRustApiResponse = (): string => `use serde::Serialize;

use crate::errors::ApiError;

#[derive(Serialize)]
#[serde(untagged)]
pub enum ApiResponse<T>
where
    T: Serialize,
{
    Ok { ok: bool, data: T },
    Err { ok: bool, error: ApiError },
}

impl<T> ApiResponse<T>
where
    T: Serialize,
{
    pub fn success(data: T) -> Self {
        Self::Ok { ok: true, data }
    }

    pub fn failure(error: ApiError) -> Self {
        Self::Err { ok: false, error }
    }
}
`;

export const templateRustErrors = (): string => `use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
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
`;

export const templateFiles = (ir: SpecIR): Record<string, string> => {
  const appName = ir.app.name;
  return {
    "package.json": templatePackageJson(appName),
    "tsconfig.json": templateTsConfig(),
    "vite.config.ts": templateViteConfig(),
    "index.html": templateIndexHtml(appName),
    "src/main.ts": templateMainTs(),
    "src/App.svelte": templateAppSvelte(),
    "src/lib/api/tauri.ts": templateTauriApi(),
    "src-tauri/Cargo.toml": templateCargoToml(appName),
    "src-tauri/build.rs": templateBuildRs(),
    "src-tauri/tauri.conf.json": templateTauriConf(appName),
    "src-tauri/capabilities/default.json": templateCapabilityDefault(),
    "src-tauri/src/lib.rs": templateRustLib(),
    "src-tauri/src/main.rs": templateRustEntry(),
    "src-tauri/src/commands/mod.rs": templateRustCommandsMod(),
    "src-tauri/src/commands/ping.rs": templateRustPing(ir),
    "src-tauri/src/api_response.rs": templateRustApiResponse(),
    "src-tauri/src/errors.rs": templateRustErrors()
  };
};
