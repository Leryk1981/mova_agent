# MOVA Agent Boundaries v0

## Responsibilities
- Agent runtime: orchestrates plans, handlers, and evidence; wires driver registry; publishes episodes; no schema copies.
- Core engine (`@leryk1981/mova-core-engine`): validation (Ajv + registry), policy checks, evidence/episode writers; no schemas or executors.
- Executors (`@leryk1981/mova-executors`): restricted shell + HTTP drivers with allowlists/timeouts; no CLI, no schemas, no policy logic.
- Schemas (`@leryk1981/mova-spec`): canonical `ds.*` / `env.*`; loaded via resolver; agent must not fork/modify.
- CLI (`@leryk1981/mova-sdk-cli`): optional tooling to scaffold/run; not required for agent runtime.

## Anti-duplication rules
- Do not copy schemas into the agent; always resolve from npm `@leryk1981/mova-spec`.
- Do not embed drivers in the agent: import from `@leryk1981/mova-executors` and keep local files as thin re-exports only.
- Core engine stays schema-free and CLI-free; executors stay policy-free; agent keeps public API stable (exports unchanged).
- Keep executor configs/secrets opt-in and out of the repo (deny-by-default, allowlists required).

## Verification probes
- Core engine: `npm run -s smoke:core-engine` → `tools/core_engine_probe_v0.mjs`.
- Executors: `npm run -s smoke:executors` → `tools/executors_probe_v0.mjs`.
