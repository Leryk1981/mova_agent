# MOVA_AGENT_TZ_v0.md
## 0. Repository layout (must be created exactly)
This project starts from scratch. The repo contains:

- `/SPEC/`
  - `MOVA_AGENT_ARCHITECTURE_v0.md`
  - `MOVA_AGENT_TZ_v0.md`
  - `MOVA_AGENT_ROADMAP_v0.md`
- `/vendor/MOVA/`  (git clone of MOVA 4.1.1 repo; read-only reference)
- `/src/`          (implementation)
- `/schemas/`      (product-layer schemas/envelopes for mova_agent)
- `/tools/`        (CLI entrypoint)
- `/tests/`        (unit/quality tests)
- `/docs/examples/` (pos/neg example fixtures)
- `/artifacts/`    (runtime output; gitignored)

Implementer MUST use `vendor/MOVA/` as the source of truth for MOVA schema ids and catalogs.

---

## 1. Hard prohibitions (fail-fast)
Implementation MUST NOT:
- generate executable code from plans (no mjs/ESM codegen)
- use `eval`, `new Function`, dynamic import of untrusted code
- let the LLM call tools or drivers
- allow any destination not explicitly allowlisted
- write secret values into logs or evidence

Any PR containing these patterns is rejected.

---

## 2. MOVA red core dependencies (must be loaded from vendor/MOVA)
The implementation MUST load and validate against MOVA 4.1.1 schemas and catalogs (paths resolved from vendor/MOVA):
- `ds.connector_core_v1`
- `ds.mova_episode_core_v1`
- `ds.security_event_episode_core_v1`
- `ds.instruction_profile_core_v1`
- `ds.runtime_binding_core_v1`
- `ds.ui_text_bundle_core_v1`
- `env.instruction_profile_publish_v1`
- `env.security_event_store_v1`
- global catalogs:
  - `global.security_catalog_v1.json`
  - `global.text_channel_catalog_v1.json`
  - `global.episode_type_catalog_v1.json`
  - `global.layers_and_namespaces_v1.json`

If any file name differs in the vendored repo:
- do NOT invent new names;
- instead, locate the correct file in vendor/MOVA and adjust paths accordingly.

---

## 3. Product-layer schemas/envelopes (must be created)
These MUST be created under `/schemas/` with `$id` using your project namespace, and MUST reference MOVA core where appropriate:

### 3.1 Envelopes
- `env.mova_agent_request_v1.schema.json`
  - carries goal + minimal context + refs to tool_pool and instruction_profile
  - verb must be one of canonical MOVA verbs (choose and document it)
- `env.mova_agent_plan_v1.schema.json`
  - carries ordered steps (v0 sequential)
  - references tool pool and instruction profile
  - includes optional `model_instruction` channel field for planner prompts (if needed) BUT must not be executed

### 3.2 Data schemas
- `ds.mova_agent_step_v1.schema.json`
- `ds.mova_agent_tool_pool_v1.schema.json`
  - MUST embed connector contracts using `ds.connector_core_v1`
  - MUST include infra bindings (driver kind, destinations, limits, schema refs)
- `ds.mova_agent_run_summary_v1.schema.json`
- `ds.mova_agent_validation_report_v1.schema.json`

v0 plan constraints (must be enforced by schema + runtime):
- no loops, no conditions, no expressions
- step may reference only prior outputs by ref (`input_from`)
- every step must identify the connector_id/tool_id it uses

---

## 4. Runtime implementation requirements (src/)
### 4.1 Ajv schema loader
Create `src/ajv/ajv_loader.ts` (or .js):
- loads MOVA schemas from `vendor/MOVA/...`
- loads project schemas from `/schemas`
- resolves `$id` correctly
- exposes:
  - `validate(schemaId, data) -> { ok: boolean, errors?: AjvError[] }`

### 4.2 Interpreter core
Create `src/interpreter/interpreter.ts`:
Single public entry:
- `runPlan({ requestEnvelope?, planEnvelope, toolPool, instructionProfile })`

Must do EXACTLY this lifecycle:
1) Ajv validate plan envelope.
2) Ajv validate tool pool.
3) Ajv validate instruction profile (using MOVA ds.instruction_profile_core_v1).
4) Build an execution context containing:
   - run_id, request_id
   - evidence directory paths
   - caps/limits from profile
   - redaction rules
5) For each step in order:
   a) resolve input
   b) validate input schema (if provided)
   c) policy checks (tool allowlist, destination allowlist, limits present)
   d) dispatch handler by binding.driver_kind from static registry
   e) execute handler
   f) validate output schema (if provided)
   g) write artifacts (inputs/outputs/logs)
   h) emit episode for the step
6) emit final run summary episode and return a structured result.

Any failure:
- must write evidence,
- must emit security event episode when applicable,
- must return a stable error code.

### 4.3 Static handler registry (must exist)
Create `src/handlers/registry.ts` exporting:
- a constant map `{ [driver_kind]: handlerFn }`

Handlers required (v0):
- `src/handlers/noop_handler.ts`
- `src/handlers/http_handler.ts` (Node fetch; allowlist destinations; caps)
- `src/handlers/restricted_shell_handler.ts` (allowlist commands/scripts; caps)
Optional:
- `src/handlers/mcp_proxy_handler.ts`

No other execution path allowed.

### 4.4 Evidence and episode writer
Create:
- `src/evidence/evidence_writer.ts`
- `src/episodes/episode_writer.ts`

Requirements:
- write deterministic directory layout under `/artifacts/mova_agent/...`
- never log secrets; redact to presence/len
- episodes must validate against:
  - `ds.mova_episode_core_v1` OR `ds.security_event_episode_core_v1`
- use `episode_type` consistent with `global.episode_type_catalog_v1.json`

### 4.5 Explain skill output (human_ui)
If explain is implemented in v0:
- it MUST generate output as `ds.ui_text_bundle_core_v1` (preferred)
- or a minimal human_ui markdown file explicitly tagged `human_ui`
- it MUST only use evidence as source (no new claims)

---

## 5. CLI / commands (tools/)
Provide CLI entrypoint `tools/mova-agent.ts` with commands:

- `plan`
  - inputs: `--goal`, `--profile`, `--tool-pool`, optional `--context`
  - outputs: writes plan envelope + validation report to artifacts and prints path

- `run-plan`
  - inputs: `--plan <path>`
  - outputs: executes without LLM, prints human summary + evidence path

- `run`
  - inputs: `--goal`, `--profile`, `--tool-pool`
  - behavior: plan → execute → (optional) explain
  - outputs: prints evidence path

- `rerun`
  - inputs: `--evidence <path>` OR `--request-id`/`--run-id`
  - behavior: re-executes stored plan/tool_pool without LLM

- `open-evidence`
  - prints resolved evidence directory path

All CLI commands MUST validate inputs and print stable exit codes.

---

## 6. Evidence layout (must be exactly)
Artifacts root:
- `artifacts/mova_agent/<request_id>/runs/<run_id>/`

Required files:
- `request.envelope.json` (redacted)
- `plan.envelope.json`
- `tool_pool.json`
- `instruction_profile.json` (resolved snapshot)
- `validation_report.json`
- `run_summary.json`
- `episodes/index.jsonl`
- `episodes/<episode_id>.json`
- `logs/<step_id>.log` (capped)

---

## 7. Quality suites (tests/ + docs/examples/)
Implement npm scripts:
- `npm run test`
- `npm run quality:pos`
- `npm run quality:neg`

Positive suite MUST cover:
- plan-only produces Ajv-valid plan
- run-plan executes noop/http echo
- episodes validate

Negative suite MUST cover:
- invalid schema → validation_failed + security event episode
- tool not allowlisted → policy_denied + security event episode
- destination not allowlisted → destination_denied + security event episode
- output invalid → output_invalid + failed episode
- timeout → timeout episode

Definition of Done:
- both quality suites PASS
- evidence contains no secrets (presence/len only)
