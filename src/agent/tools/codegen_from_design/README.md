# tool_codegen_from_design

## What it does
Deterministically generates business glue code from design artifacts before verify.

## When to use
- When phase == CODEGEN_FROM_DESIGN
- After materialized design artifacts are present on disk

## Inputs
- `projectRoot` (string)
- `apply` (boolean)

## Outputs
- `ok` (true)
- `generated` (relative file paths)
- `summary` (`wrote` / `skipped`)

## Side effects
- Filesystem writes when `apply=true`

## Examples
{"name":"tool_codegen_from_design","input":{"projectRoot":"./generated/app","apply":true}}

## Failure handling
- Returns `CODEGEN_FROM_DESIGN_FAILED` with a clear message
- Missing `forgetauri.contract.json` is treated as hard failure

## Constraints / safety
- Deterministic only: no LLM calls
- Writes only under `projectRoot`
- Writes generated zone files only
