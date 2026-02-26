# tool_design_implementation

## What it does
Designs implementation layering for Rust and frontend integration based on contract and optional UX design.

## When to use
- When phase == DESIGN_IMPL
- After contract and UX design are available

## Inputs
- `goal` (string)
- `contract` (`ContractDesignV1`)
- `ux` (`UXDesignV1`, optional)
- `projectRoot` (optional string)

## Outputs
- `impl` (`ImplementationDesignV1`)
- `attempts`

## Side effects
- LLM call only

## Examples
{"name":"tool_design_implementation","input":{"goal":"Design layering","contract":{...}}}

## Failure handling
- Returns `DESIGN_IMPLEMENTATION_FAILED` with details

## Constraints / safety
- Must return strict JSON matching schema
- No filesystem writes
