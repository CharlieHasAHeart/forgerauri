# tool_repair_known_issues

## What it does
Applies deterministic repairs for common Tauri packaging/configuration issues before LLM-based repair.

## When to use
- When phase == REPAIR
- Before calling `tool_repair_once`

## Inputs
- `projectRoot` (string): generated project root path

## Outputs
- `ok` (boolean)
- `changed` (boolean)
- `fixes`: list of applied fixes with touched paths
- `summary` (string)

## Side effects
- Filesystem writes inside `projectRoot` only

## Examples
{"name":"tool_repair_known_issues","input":{"projectRoot":"./generated/app"}}

## Failure handling
- Returns `ok=false` with `REPAIR_KNOWN_ISSUES_FAILED` when reading/writing/parsing fails.

## Constraints / safety
- Never writes outside `projectRoot`
- Uses deterministic, idempotent `writeIfChanged` behavior
- Does not call LLM
