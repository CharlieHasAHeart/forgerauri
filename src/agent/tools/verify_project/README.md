# tool_verify_project

## What it does
Runs project verification gates in fixed order and returns structured step results.

## When to use
- When phase == VERIFY
- After bootstrap/apply and after each repair attempt

## Inputs
- `projectRoot` (string): generated app root
- `verifyLevel` ("basic"|"full")

## Outputs
- `ok`
- `step` (failed step name or `none`)
- `results` (all gate steps)
- `classifiedError`
- `summary` and `suggestion`

## Side effects
- Executes commands (`pnpm`, `cargo`, `tauri`)

## Examples
Basic verify:
{"name":"tool_verify_project","input":{"projectRoot":"./generated/app","verifyLevel":"basic"}}

Full verify:
{"name":"tool_verify_project","input":{"projectRoot":"./generated/app","verifyLevel":"full"}}

## Failure handling
- If `ok=false`, use `step` and `classifiedError` to choose minimal repair command

## Constraints / safety
- Does not write files
- Respects command allowlist through runtime command runner
