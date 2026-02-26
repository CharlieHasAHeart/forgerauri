# DashScope Responses Capability Probe

Run:

```bash
pnpm tsx scripts/probe_dashscope_responses.ts
```

Environment variables:

- `DASHSCOPE_API_KEY` (required)
- `DASHSCOPE_BASE_URL` (optional, default `https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1`)
- `DASHSCOPE_MODEL` (optional, default `qwen3-max-2026-01-23`)
- `PROBE_TIMEOUT_MS` (optional, default `30000`)
- `PROBE_OUTFILE` (optional, default `generated/dashscope_capabilities.json`)

Output report:

- `generated/dashscope_capabilities.json`
