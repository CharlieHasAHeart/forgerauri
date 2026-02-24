# tool_repair_once

## What it does
Runs one repair loop on a failed command and applies resulting patches through guarded plan/apply flow.

## When to use
- When phase == REPAIR
- Only after verify failure and if repair budget remains

## Inputs
- `projectRoot` (string)
- `cmd` (string)
- `args` (string[])

## Outputs
- `ok`
- `summary`
- `patchPaths` (if any)

## Side effects
- LLM call for patch proposal
- Filesystem updates in generated zone and patch file output for user zone

## Examples
{"name":"tool_repair_once","input":{"projectRoot":"./generated/app","cmd":"pnpm","args":["-C","./generated/app","build"]}}

## Failure handling
- If `ok=false`, stop and surface error to runtime

## Constraints / safety
- User zone is patch-only
- Patch count bounded by runtime budget
