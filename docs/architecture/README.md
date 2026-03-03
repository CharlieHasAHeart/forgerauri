# Agent Architecture (Converged)

## Directory Layout

```text
src/agent/
  core/
    acceptance/        # catalog + intents + requirements + deterministic engine
    evidence/          # event types + JSONL reader/logger
    runtime_paths/     # canonical path helpers (pure)
    workspace/         # workspace snapshot
    index.ts
  runtime/
    run.ts
    orchestrator.ts
    turn.ts
    task_runner.ts
    task_attempt.ts
    executor.ts
    policy/
      policy.ts
      loaders.ts
    get_runtime_paths.ts
    index.ts
  tools/
    core/              # tool packages
    impl/              # tool implementation logic (verify_project)
    registry.ts
```

## Dependency Rules

- `core/*` must not import `runtime/*` or `tools/*`.
- `runtime/*` can import `core/*`.
- `tools/*` can import `core/*`; avoid importing `runtime/*` except shared context types.
- `verify_project` execution and acceptance must both use `core/acceptance/catalog.ts`.

## Single Source of Truth

1. Acceptance commands + pipeline:
   - `src/agent/core/acceptance/catalog.ts`
2. Runtime paths:
   - `src/agent/runtime/get_runtime_paths.ts` (bridge)
   - canonical helpers in `src/agent/core/runtime_paths/`
3. Evidence:
   - types `src/agent/core/evidence/types.ts`
   - writer `src/agent/core/evidence/logger.ts`
   - reader `src/agent/core/evidence/reader.ts`

## Migration Notes

Moved modules:
- `src/agent/core/acceptance_catalog.ts` -> `src/agent/core/acceptance/catalog.ts`
- `src/agent/core/acceptance_engine.ts` -> `src/agent/core/acceptance/engine.ts`
- `src/agent/core/intent.ts` -> `src/agent/core/acceptance/intent.ts`
- `src/agent/core/requirement.ts` -> `src/agent/core/acceptance/requirement.ts`
- `src/agent/core/cwd_policy.ts` -> `src/agent/core/acceptance/cwd_policy.ts`
- `src/agent/core/evidence.ts` -> `src/agent/core/evidence/types.ts`
- `src/agent/core/evidence_reader.ts` -> `src/agent/core/evidence/reader.ts`
- `src/agent/core/evidence_logger.ts` -> `src/agent/core/evidence/logger.ts`
- `src/agent/core/runtime_paths.ts` -> `src/agent/core/runtime_paths/types.ts`
- `src/agent/core/cwd_normalize.ts` -> `src/agent/core/runtime_paths/cwd_normalize.ts`
- `src/agent/core/path_normalizer.ts` -> `src/agent/core/runtime_paths/path_normalizer.ts`
- `src/agent/core/workspace_snapshot.ts` -> `src/agent/core/workspace/snapshot.ts`
- `src/agent/tools/verifyProject.ts` -> `src/agent/tools/impl/verify_project.ts`
- `src/agent/policy/*` -> `src/agent/runtime/policy/*`

## Debug Flow

1. Read `<outDir>/run_evidence.jsonl`.
2. Locate:
   - `acceptance_step_started/skipped/finished`
   - `command_ran` with `command_id`
3. If runtime fails with `VERIFY_ACCEPTANCE_FAILED`:
   - inspect acceptance diagnostics in state/audit
   - compare missing `acceptance_step` requirements against evidence.
