# Naming Conventions

This document defines where code goes and which names are allowed in architecture discussions.

## Placement Rules

- Core engine: `src/core/agent/**`
- Middleware packages: `src/core/middleware/**`
- Tool implementations: middleware package files (or middleware-focused subfolders)
- Profiles: `src/profiles/**`
- Contracts (ports/interfaces): `src/core/contracts/**`

## Naming Rules

- Middleware factory names: `createXMiddleware`
  - Example: `createFilesystemMiddleware`
- Tool names in registry: `snake_case`
  - Examples: `read_file`, `write_file`, `read_blob`
- Hook names: `onX` pattern, consistent with `KernelHooks`
  - Examples: `onToolResult`, `onPatchPathsChanged`
- Core entrypoint: `runCoreAgent`
- Workspace contract: `Workspace`

## Prohibited Terminology Drift

- Do not introduce alternate names for:
  - `core`
  - `KernelMiddleware`
  - `ToolSpec`
  - `KernelHooks`
  - `profile`
  - `workspace`
- Do not add alias exports for terminology.
- Keep code identifiers as the single source of truth.
