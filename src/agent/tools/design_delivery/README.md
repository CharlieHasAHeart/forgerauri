# tool_design_delivery

## What it does
Designs delivery policy including verify gates, preflight checks, and required assets.

## When to use
- When phase == DESIGN_DELIVERY
- After contract design exists

## Inputs
- `goal` (string)
- `contract` (`ContractDesignV1`)
- `projectRoot` (optional string)

## Outputs
- `delivery` (`DeliveryDesignV1`)
- `attempts`

## Side effects
- LLM call only

## Examples
{"name":"tool_design_delivery","input":{"goal":"Define release policy","contract":{...}}}

## Failure handling
- Returns `DESIGN_DELIVERY_FAILED` with details

## Constraints / safety
- Must return strict JSON matching schema
- No filesystem writes
