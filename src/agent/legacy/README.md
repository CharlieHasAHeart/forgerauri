# Legacy Modules

This folder contains non-primary agent workflows kept for compatibility and targeted tools.

Rules:
- Runtime main loop (`src/agent/runtime/*`) must not import from `src/agent/legacy/*`.
- Legacy modules can be used by dedicated tools and tests only.
- New architecture work should prefer `core/`, `runtime/`, and `tools/impl/` paths.
