# tool_bootstrap_project

## What it does
Bootstraps a project from spec using the deterministic generator pipeline.

## When to use
- When phase == BOOT
- First high-level action for any goal that needs generated project files

## Inputs
- `specPath` (string): path to input spec JSON
- `outDir` (string): output base directory
- `apply` (boolean): write files when true, otherwise dry-run

## Outputs
Returns bootstrap summary:
- `ok`
- `appDir`
- `usedLLM`
- `planSummary`
- `applySummary`

## Side effects
- Filesystem writes if `apply=true`
- LLM call during mandatory spec enrichment

## Examples
Tool call:
{"name":"tool_bootstrap_project","input":{"specPath":"/tmp/spec.json","outDir":"./generated","apply":true}}

## Failure handling
- On failure, inspect error message and stop bootstrap retries

## Constraints / safety
- Must respect zones and patch-only behavior for user zone via plan/apply layer
