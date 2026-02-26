# tool_design_ux

## What it does
Designs UX information architecture, screens, states and actions from contract commands.

## When to use
- When phase == DESIGN_UX
- After contract is designed and before materialization

## Inputs
- `goal`
- `specPath`
- `contract`
- `projectRoot` (optional)

## Outputs
- `ux` (UXDesignV1)
- `attempts`

## Side effects
- LLM call only

## Examples
{"name":"tool_design_ux","input":{"goal":"Design ux","specPath":"/tmp/spec.json","contract":{...}}}

## Failure handling
- Returns `DESIGN_UX_FAILED`

## Constraints / safety
- Strict JSON schema output only
