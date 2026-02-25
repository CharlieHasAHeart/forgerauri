# tool_verify_project

## What it does
Runs fixed verification gates for a generated Tauri project in deterministic order.

## When to use
- When phase == VERIFY
- Before REPAIR decision

## Inputs
- `projectRoot` (string)

## Outputs
Returns `VerifyProjectResult`:
- `ok`
- `step`
- `results`
- `summary`
- `classifiedError`
- `suggestion`

## Side effects
- Executes commands (`pnpm`, `cargo`, `tauri`)

## Examples
{"name":"tool_verify_project","input":{"projectRoot":"./generated/app"}}

## Failure handling
- If `ok=false`, use `step` + `classifiedError` to decide repair action

## Constraints / safety
- Runs full gate sequence: install(if needed) -> build -> cargo check -> tauri --help -> tauri build
- No direct file writes
