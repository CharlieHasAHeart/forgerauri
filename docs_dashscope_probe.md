# DashScope Responses Capability Probe

Primary compatibility guide generator:

```bash
pnpm tsx scripts/probe_bailian_responses_compat.ts
```

Legacy quick probe (kept for focused checks):

```bash
pnpm tsx scripts/probe_dashscope_responses.ts
```

Environment variables:

- `DASHSCOPE_API_KEY` (required)
- `DASHSCOPE_BASE_URL` (optional, default `https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1`)
- `DASHSCOPE_MODEL` (optional, default `qwen3-max-2026-01-23`)
- `PROBE_MODELS` (optional, comma-separated model list)
- `PROBE_TIMEOUT_MS` (optional, default `30000`)
- `PROBE_REPEAT` (optional, default `2`)
- `PROBE_OUTDIR` (optional, default `generated`)

Generated outputs:

- `generated/bailian_responses_compatibility.json`
- `generated/bailian_responses_compatibility.md`
- (legacy) `generated/dashscope_capabilities.json`
