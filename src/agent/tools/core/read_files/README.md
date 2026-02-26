# tool_read_files

## What it does
Reads files by glob pattern for contextual diagnosis.

## When to use
- Need additional context before planning repair
- Read-only inspection of generated project

## Inputs
- `projectRoot` (string)
- `globs` (string[])
- `maxChars` (number, optional)

## Outputs
- `files[]` with `path/content/truncated`
- `total`
- `totalChars`

## Side effects
- None (read-only)

## Examples
{"name":"tool_read_files","input":{"projectRoot":"./generated/app","globs":["src/lib/screens/generated/**"],"maxChars":20000}}

## Failure handling
- Return structured read error

## Constraints / safety
- Reads only inside provided projectRoot
