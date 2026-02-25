# tool_materialize_implementation

## What it does
Materializes implementation design artifacts into project files the team can inspect and import.

## When to use
- When phase == MATERIALIZE_IMPL
- Immediately after `tool_design_implementation` succeeds

## Inputs
- `impl` (`ImplementationDesignV1`)
- `projectRoot` (string)
- `apply` (boolean)

## Outputs
- `implPath`
- `summary` (`wrote` / `skipped`)

## Side effects
- Filesystem writes when `apply=true`

## Examples
{"name":"tool_materialize_implementation","input":{"impl":{...},"projectRoot":"./generated/app","apply":true}}

## Failure handling
- Returns `MATERIALIZE_IMPLEMENTATION_FAILED` with details

## Constraints / safety
- Writes only under `projectRoot`
- Uses write-if-changed for deterministic/idempotent output
