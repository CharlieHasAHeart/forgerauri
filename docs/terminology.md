# Terminology

This repository uses one set of terms. Code identifiers are authoritative.

## Canonical Glossary

| Concept | Canonical term in docs | Canonical code identifier / location | Example |
| --- | --- | --- | --- |
| MicroKernel engine | `core` | `src/core/agent/**` | `runCoreAgent`, `orchestrator`, `executor` |
| Middleware plugin package | `middleware` | `KernelMiddleware` (`src/core/middleware/types.ts`) | `createFilesystemMiddleware` |
| Tool | `tool` | `ToolSpec` (`src/core/contracts/tools.ts`) | `read_file`, `write_file`, `read_blob` |
| Hook callback point | `hook` | `KernelHooks` (`src/core/contracts/hooks.ts`) | `onToolResult`, `onPatchPathsChanged` |
| Provider wrapper | `wrapper` | `wrapProvider` (`KernelMiddleware`) | filesystem provider wrapper |
| External assembler | `profile` | `src/profiles/**` | `src/profiles/placeholder.ts` |
| Workspace namespace | `workspace` | `Workspace` (`src/core/contracts/workspace.ts`) | `root`, `runDir`, `paths` |

## Strict Rules

- Do not call a `tool` a plugin.
- Do not call a `profile` a middleware.
- Use `middleware` to refer to `KernelMiddleware` packages.
- Use `tool` to refer to `ToolSpec` registry entries.
- Use `hook` to refer to `KernelHooks` callbacks.

## Architecture (Canonical Words Only)

```text
profile
  -> runCoreAgent
      -> core (flow + execution + policy + telemetry)
      -> middleware (KernelMiddleware)
           -> tool registry entries (ToolSpec)
           -> wrapper (wrapProvider)
           -> hook callbacks (KernelHooks)
      -> workspace (Workspace)
```
