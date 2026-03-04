# Core Microkernel

This directory is the runnable microkernel of the agent. It is intentionally self-contained.

## Architecture

- `contracts/`: stable plugin/port interfaces.
  - `llm.ts`: LLM port surface.
  - `planning.ts`: planner contracts (plan + task tool calls + replan).
  - `tools.ts`: tool registry contracts and runtime context.
  - `runtime.ts`: runtime path resolver contract and command runner port.
  - `policy.ts`: policy model contract.
  - `state.ts`: kernel state model.
- `agent/`: core state machine and execution loop.
  - `runAgent.ts`: kernel entrypoint.
  - `orchestrator.ts`: Plan -> Turn orchestration.
  - `turn.ts`: turn selection and transitions.
  - `task_runner.ts`: retries and replan trigger.
  - `task_attempt.ts`: planner -> action plan execution bridge.
  - `executor.ts`: tool execution and deterministic criteria evaluation.
  - `replanner.ts`: deterministic gated replan flow.
- `defaults/noopPlanner.ts`: default planner fallback to keep kernel runnable.
- `runtime_paths/`: default runtime path resolver implementation.
- `planning/` and `tools/`: concrete local type modules used by contracts.

## Execution flow

1. `runAgent` builds initial state and runtime context.
2. `orchestrator` asks injected `Planner.proposePlan` for initial plan.
3. Each turn:
   - pick next ready task
   - ask injected `Planner.proposeToolCallsForTask`
   - execute tool calls through registry
   - run deterministic success criteria checks
4. On task failure after retries, `replanner` asks injected planner for patch proposal.
5. Terminal states: `done` or `failed`, audit is flushed.

## Dependency rule

Core files only import from `src/core/**`. External systems must be injected via contracts.
