# tool_check_command

## What it does
Runs a command and validates expected exit code.

## Inputs
- `cmd`, `args`, optional `cwd`
- `expect_exit_code` (default 0)

## Outputs
- `{ ok, code, stdout, stderr, cwd }`

## Side effects
- executes command
