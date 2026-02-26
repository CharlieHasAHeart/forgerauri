# tool_validate_design

## What it does
Deterministically validates cross-design consistency across contract, UX, implementation, and delivery artifacts.

## When to use
- When phase == VALIDATE_DESIGN
- Before `tool_codegen_from_design`

## Inputs
- `projectRoot` (string)
- Optional overrides for testing:
  - `contract`
  - `ux`
  - `implementation`
  - `delivery`

## Outputs
- `ok` (boolean)
- `errors` (array of `{ code, message, path? }`)
- `summary` (string)

## Side effects
- None

## Examples
{"name":"tool_validate_design","input":{"projectRoot":"./generated/app"}}

## Failure handling
- If files are missing or JSON is invalid, returns `ok=false` with detailed errors.
- Tool runtime itself only returns `ok=false` for execution errors (e.g. filesystem read failure).

## Constraints / safety
- Deterministic only: no LLM calls
- Read-only validation
