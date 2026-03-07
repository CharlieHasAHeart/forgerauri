# ForgeTauri

A repository focused on the **Agent architecture specification and layout**.

This project currently keeps a clean structure for:

- `core`: runtime semantics and state-machine design
- `shell`: effect execution boundary
- `profiles`: scenario assembly boundary
- `protocol`: Core↔Shell contracts

## Repository Layout

```text
.
├── AGENTS.md
├── README.md
├── docs/
│   ├── architecture/
│   │   ├── 01-agent_architecture_glossary.md
│   │   ├── 02-core_shell_profile_architecture_spec.md
│   │   ├── 03-core_internal_design_and_agent_loop_spec.md
│   │   ├── 04-shell_internal_design_and_effect_handling_spec.md
│   │   ├── 05-profile_design_and_assembly_spec.md
│   │   └── 06-core_shell_protocol_and_data_model_spec.md
│   └── planning/
│       └── 07-implementation_roadmap.md
├── src/
│   ├── core/
│   ├── shell/
│   ├── profiles/
│   └── protocol/
└── tests/
    ├── core/
    ├── shell/
    └── protocol/
```

## Scripts

- `pnpm build`: TypeScript compilation
- `pnpm test`: run tests
- `pnpm test:watch`: watch mode

## Development Notes

1. Keep architectural semantics in `docs/architecture/*` consistent with code structure.
2. Do not couple workflow-specific logic into `core`.
3. Add tests under layer-specific folders:
   - `tests/core`
   - `tests/shell`
   - `tests/protocol`

## Roadmap

See `docs/planning/07-implementation_roadmap.md`.
