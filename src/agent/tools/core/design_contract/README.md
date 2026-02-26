# tool_design_contract

## What it does
Designs a structured business contract (commands + data model + acceptance criteria) from goal and raw spec.

## When to use
- When phase == DESIGN
- After bootstrap created app scaffold and before materializing domain artifacts

## Inputs
- `goal` (string)
- `specPath` (string)
- `rawSpec` (optional unknown)
- `projectRoot` (optional string)

## Outputs
- `contract` (ContractDesignV1)
- `attempts` (LLM JSON retry attempts)

## Side effects
- LLM API call only

## Examples
{"name":"tool_design_contract","input":{"goal":"Design lint/fix contracts","specPath":"/tmp/spec.json"}}

## Failure handling
- Returns `DESIGN_CONTRACT_FAILED` with validation/message details

## Constraints / safety
- Output must be strict JSON schema
- Command/table names must be snake_case
