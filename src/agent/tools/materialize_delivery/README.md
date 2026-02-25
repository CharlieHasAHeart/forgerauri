# tool_materialize_delivery

## What it does
Materializes delivery artifacts (`delivery.json`, `delivery.ts`, preflight script) and ensures required icon assets exist.

## When to use
- When phase == MATERIALIZE_DELIVERY
- Immediately after `tool_design_delivery` succeeds

## Inputs
- `delivery` (`DeliveryDesignV1`)
- `projectRoot` (string)
- `apply` (boolean)

## Outputs
- `deliveryPath`
- `summary` (`wrote` / `skipped`)

## Side effects
- Filesystem writes when `apply=true`

## Examples
{"name":"tool_materialize_delivery","input":{"delivery":{...},"projectRoot":"./generated/app","apply":true}}

## Failure handling
- Returns `MATERIALIZE_DELIVERY_FAILED` with details

## Constraints / safety
- Writes only under `projectRoot`
- Uses write-if-changed
- If `assets.icons.required=true`, creates `src-tauri/icons/icon.png` when missing
