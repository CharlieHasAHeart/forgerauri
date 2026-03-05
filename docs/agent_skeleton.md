# Agent Skeleton

This is the quick map of the current plan-first core runtime.

## 1) Entry and Runtime Boot

- Entry: `src/core/agent/flow/runAgent.ts`
- Responsibilities:
  - build initial `AgentState`
  - build `ToolRunContext` (`ctx.memory` as shared runtime memory)
  - install middleware (`KernelMiddleware`)
  - call orchestrator loop
  - flush audit

## 2) Execution Chain

- `src/core/agent/flow/orchestrator.ts`
  - Plan -> Turn loop -> terminal state
- `src/core/agent/flow/turn.ts`
  - choose next task and run retries
- `src/core/agent/flow/task_runner.ts`
  - per-task retry and replan boundary
- `src/core/agent/flow/task_attempt.ts`
  - propose tool calls for one attempt
  - execute action plan
- `src/core/agent/execution/executor.ts`
  - execute each tool call with policy/schema checks
  - evaluate deterministic success criteria

## 3) Core Contracts

- `src/core/contracts/llm.ts`: LLM port
- `src/core/contracts/tools.ts`: tool (`ToolSpec`) contract
- `src/core/contracts/hooks.ts`: hook (`KernelHooks`) contract
- `src/core/contracts/runtime.ts`: runtime paths + command runner
- `src/core/contracts/state.ts`: agent state contract
- `src/core/contracts/workspace.ts`: workspace contract

## 4) Runtime Paths

- Resolver: `src/core/runtime_paths/getRuntimePaths.ts`
- Priority: `state.runtimePaths > ctx.memory.runtimePaths > fallback inference`
- Canonical runtime paths:
  - `repoRoot`
  - `appDir`
  - `tauriDir`

## 5) Middleware and Tools

- Middleware contract: `src/core/middleware/types.ts` (`KernelMiddleware`)
- Middleware installer: `src/core/middleware/applyMiddlewares.ts`
- Example middleware package: `src/core/middleware/filesystem.ts`
  - registers tool entries (`read_file`, `write_file`, `edit_file`, `glob`, `grep`, `read_blob`)
  - wraps provider via `wrapProvider`
  - emits hook behavior through `KernelHooks`

## 6) Profile Boundary

- Profiles live in `src/profiles/**`.
- Core must not import profile modules.
- Profile role: assemble `{ request, workspace, runtime, deps }` for `runCoreAgent`.

## 7) Debugging Guide

1. Inspect audit JSON in `<runDir>/generated/agent_logs/`.
2. Check per-turn tool calls/results and failure note.
3. If a task fails repeatedly, inspect:
   - state summary (`src/core/agent/state/state_summary.ts`)
   - planner output validity and criteria failures in audit turns.
