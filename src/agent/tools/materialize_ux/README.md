# tool_materialize_ux

## What it does
Materializes UX design artifacts into project files that the frontend can import.

## When to use
- When phase == MATERIALIZE_UX
- Immediately after `tool_design_ux` succeeds

## Inputs
- `ux` (`UXDesignV1`)
- `projectRoot` (string)
- `apply` (boolean)

## Outputs
- `uxPath`
- `summary` (`wrote` / `skipped`)

## Side effects
- Filesystem writes when `apply=true`

## Examples
{"name":"tool_materialize_ux","input":{"ux":{...},"projectRoot":"./generated/app","apply":true}}

## Failure handling
- Returns `MATERIALIZE_UX_FAILED` with details

## Constraints / safety
- Writes only under `projectRoot`
- Uses write-if-changed for idempotency
