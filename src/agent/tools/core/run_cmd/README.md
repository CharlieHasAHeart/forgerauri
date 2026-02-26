# tool_run_cmd

## What it does
Executes a single shell command with whitelist enforcement.

## When to use
- Low-level diagnostics
- Rare fallback when high-level tools are insufficient

## Inputs
- `cwd` (string)
- `cmd` (string)
- `args` (string[])

## Outputs
- `ok`
- `code`
- `stdout`
- `stderr`

## Side effects
- Command execution only

## Examples
{"name":"tool_run_cmd","input":{"cwd":"./generated/app/src-tauri","cmd":"cargo","args":["check"]}}

## Failure handling
- Check `stderr` and return structured error

## Constraints / safety
- Command must be in allowlist
