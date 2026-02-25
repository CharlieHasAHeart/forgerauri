# tool_materialize_contract

## What it does
Materializes a validated contract design into project files so deterministic generators and UI can consume business metadata.

## When to use
- When phase == MATERIALIZE
- Immediately after `tool_design_contract` succeeds

## Inputs
- `contract` (ContractDesignV1)
- `outDir` (string)
- `appNameHint` (optional string)
- `apply` (boolean)

## Outputs
- `appDir`
- `contractPath`
- `summary` (`wrote` / `skipped`)

## Side effects
- Filesystem writes when `apply=true`

## Examples
{"name":"tool_materialize_contract","input":{"contract":{...},"outDir":"./generated","apply":true}}

## Failure handling
- Returns `MATERIALIZE_CONTRACT_FAILED` with details

## Constraints / safety
- Writes only inside resolved outDir/appSlug
- Produces deterministic SQL (`CREATE TABLE IF NOT EXISTS` + indices)
