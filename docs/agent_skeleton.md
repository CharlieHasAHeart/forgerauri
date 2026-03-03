# Agent Skeleton

This document is the quick map of the current plan-first agent runtime and acceptance architecture.

## 1) Entry and Runtime Boot

- Entry: `src/agent/runtime/run.ts`
- Responsibilities:
  - build initial `AgentState`
  - build `ToolRunContext` (`ctx.memory` as cross-tool runtime memory)
  - initialize registry/provider/policy
  - call orchestrator loop
  - flush audit

## 2) Execution Chain

- `src/agent/runtime/orchestrator.ts`
  - Plan -> Turn loop -> terminal state
- `src/agent/runtime/turn.ts`
  - choose next task and run retries
- `src/agent/runtime/task_runner.ts`
  - per-task retry and replan boundary
- `src/agent/runtime/task_attempt.ts`
  - propose tool calls for one attempt
  - execute action plan
  - write per-turn evidence context (`run_id/turn/task_id`)
- `src/agent/runtime/executor.ts`
  - execute each tool call with policy/schema checks
  - emit evidence events and enforce acceptance gate after `tool_verify_project`

## 3) Evidence System

- Writer: `src/agent/core/evidence/logger.ts`
- Reader: `src/agent/core/evidence/reader.ts`
- File: `<outDir>/run_evidence.jsonl`

Event types:
- `tool_called`
- `tool_returned`
- `command_ran` (with `command_id` when available)
- `acceptance_step_started`
- `acceptance_step_skipped`
- `acceptance_step_finished`

The evidence stream is append-only and used for deterministic replay/diagnosis.

## 4) Runtime Paths (single runtime truth)

- Type: `src/agent/core/runtime_paths/types.ts`
- Resolver: `src/agent/runtime/get_runtime_paths.ts`
- Priority: `state.runtimePaths > ctx.memory.runtimePaths > fallback inference`

These paths feed both execution and acceptance:
- `repoRoot`
- `appDir`
- `tauriDir`

## 5) Acceptance Pipeline Catalog (single source of truth)

- `src/agent/core/acceptance/catalog.ts`
- Golden pipeline: `desktop_tauri_default`

The catalog defines:
- command list (`command_id -> cmd/args/cwd_policy/expect_exit_code`)
- pipeline step order (+ `optional`)
- execution policy (`retries`, `prechecks`)

`verify_project` execution and acceptance verification both depend on this same catalog to prevent drift.

## 6) Deterministic Acceptance Engine

- `src/agent/core/acceptance/engine.ts`
- key intents:
  - `verify_acceptance_pipeline`
  - `verify_command`
  - `verify_tool_exit`
  - `bootstrap`
  - `ensure_paths`

For `verify_acceptance_pipeline`:
- required steps require successful `command_ran`
- optional steps can be satisfied by:
  - successful `command_ran`, or
  - `acceptance_step_skipped` for the same step
- matching prefers `command_id` and still checks cmd/args/cwd/exit_code

## 7) verify_project Closed Loop

- Executor: `src/agent/tools/impl/verify_project.ts`
  - executes pipeline steps from catalog
  - applies retry/precheck policy
  - emits step-level evidence callbacks
- Tool wrapper: `src/agent/tools/core/verify_project/index.ts`
  - loads previous evidence
  - enables `skip_if_cmd_ran_ok`
  - writes `command_ran` and step events to evidence
- Runtime gate: `src/agent/runtime/executor.ts`
  - runs `evaluateAcceptanceRuntime(...)` after `tool_verify_project`
  - if not satisfied -> sets `VERIFY_ACCEPTANCE_FAILED` and fails the tool result

## 8) Debugging Guide

1. Open latest `run_evidence.jsonl`.
2. Locate `acceptance_step_*` around failed stage:
   - skipped reason (`precheck_skip_if_exists` / `precheck_skip_if_cmd_ran_ok`)
3. Check matching `command_ran`:
   - `command_id`
   - canonical `cwd`
   - `exit_code`
4. If runtime fails with `VERIFY_ACCEPTANCE_FAILED`:
   - inspect acceptance diagnostics in state/audit
   - compare missing `acceptance_step` requirements vs evidence stream
