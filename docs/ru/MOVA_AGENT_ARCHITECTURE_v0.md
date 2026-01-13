# MOVA_AGENT_ARCHITECTURE_v0.md
## 0. Absolute intent (do not reinterpret)
We are building **MOVA Agent v0** from scratch in a new repository.

This repository will contain:
1) **ONLY these three specification files** (this file + TZ + Roadmap) as the project brief.
2) A **vendored clone of MOVA 4.1.1** (as a read-only reference source for schemas/docs).
3) The implementation that a strong coding model will write “from A to Z”.

**Non-negotiable architecture:**
- ✅ MOVA is a contract language, not a runtime.
- ✅ The agent is a **deterministic interpreter runtime**.
- ✅ Execution uses a **static registry of handlers**.
- ✅ Plans are **MOVA envelopes** (speech-acts), not scripts.
- ✅ Evidence is **structured episodes** (`ds.mova_episode_core_v1` and `ds.security_event_episode_core_v1`).
- ✅ Strict separation of text channels: `human_ui`, `model_instruction`, `system_log`.
- ✅ **NO code generation** of executable step code.
- ✅ **NO dynamic eval/import**.
- ✅ LLM **never** gets tool access; LLM produces plans only.

If any implementer proposes “compile plan to mjs/ESM”, “generate step runners”, “eval”, “model executes tools” — they are implementing the wrong system.

---

## 1. MOVA 4.1.1 reference source (vendored)
The repo includes a cloned folder:
- `vendor/MOVA/` — a read-only copy of MOVA 4.1.1 repo, used only for:
  - schema ids ($id) and JSON Schema loading,
  - global catalogs,
  - envelope and episode contracts,
  - docs for semantic intent.

The implementation MUST:
- load schemas from `vendor/MOVA/` (or from MOVA-published `$id` URLs if also vendored locally),
- validate inputs/outputs/episodes with Ajv,
- align identifiers with the canonical English names used in MOVA.

---

## 2. System boundaries (what MOVA Agent is and is not)

### 2.1 What MOVA Agent is
MOVA Agent is an **executor implementation** that:
- accepts MOVA envelopes and MOVA-like product envelopes as boundary inputs,
- validates them,
- executes a plan deterministically via handlers,
- records episodes.

### 2.2 What MOVA Agent is not
- not a workflow engine with code generation,
- not an “LLM with tool access” system,
- not a scheduler/concurrency framework,
- not MCP Enterprise (no approvals/roles matrix/pipeline in v0).

---

## 3. Components and responsibility split (hard boundaries)

### 3.1 Commands (user entrypoints)
**Command** is a CLI/UX entrypoint.
Responsibilities:
- collect minimal context,
- create a **request envelope**,
- choose:
  - `instruction_profile_ref` (guardrails),
  - `tool_pool_ref` (allowlist menu),
- execute one mode:
  - plan-only
  - run-plan
  - full-cycle
- show short `human_ui` output and evidence directory path.

Commands MUST NOT:
- call tools/drivers directly,
- embed business logic,
- bypass Ajv validation.

### 3.2 Skills (LLM interface)
A **Skill** is an LLM adapter that produces **strict JSON** validated against schemas.
Skill types:
1) Planner skill → outputs `env.mova_agent_plan_v1`
2) Plan-repair skill → fixes invalid plan OR refuses via a security event episode
3) Explain skill → produces `human_ui` report from evidence only

Skills MUST NOT:
- execute anything,
- call tools,
- output unvalidated JSON,
- mix text channels (respect `global.text_channel_catalog_v1.json`).

### 3.3 Interpreter runtime (the only executor)
Interpreter is the deterministic runtime core.
It:
- validates plan/tool_pool/profile,
- executes steps sequentially (v0),
- dispatches to handlers from a static registry,
- validates outputs,
- writes evidence and episodes.

### 3.4 Tool Pool (allowlist using MOVA connector contracts)
Tool pool is an allowlist menu. It is built from:
- connector contracts (`ds.connector_core_v1`) + infra bindings:
  - driver kind (http/restricted_shell/noop/mcp_proxy),
  - destination allowlist,
  - limits,
  - schema refs.

Planner must only select tools from this pool.
Interpreter must enforce this.

### 3.5 Episodes (truth layer)
All meaningful work is recorded as episodes:
- base episode: `ds.mova_episode_core_v1`
- security event episode: `ds.security_event_episode_core_v1`
Security events are stored/recorded per MOVA via:
- `env.security_event_store_v1` (verb `record`).

Episode semantics follow:
- `global.episode_type_catalog_v1.json` (e.g. `plan/*`, `execution/*`, `security_event/*`).

---

## 4. Plan as envelope (no scripts)
We define a product-layer plan envelope:
- `env.mova_agent_plan_v1`

Plan is declarative:
- ordered steps
- each step has:
  - `verb` (canonical MOVA verb type; operation type, not implementation),
  - references to tool pool connector_id + binding,
  - input (inline or input_from),
  - expected output schema ref (optional but recommended),
  - on_error (fatal/soft)

Hard v0 prohibitions:
- no loops
- no conditions
- no expressions
- no “free-form code” fields

---

## 5. Interpreter execution lifecycle (exact)
Given:
- validated `env.mova_agent_plan_v1`
- validated tool pool
- resolved instruction profile

Interpreter MUST:
1) Validate plan envelope with Ajv.
2) Validate tool pool with Ajv.
3) Resolve instruction profile and enforce deny-by-default.
4) For each step in order:
   a) Resolve input (inline or input_from).
   b) Validate step input (Ajv).
   c) Policy check:
      - tool (connector_id) allowlisted
      - destination allowlisted (if applicable)
      - limits present (timeout/caps)
   d) Select handler by `binding.driver_kind` from **static registry**.
   e) Execute handler deterministically.
   f) Validate output (Ajv) if output schema ref provided.
   g) Write evidence artifacts.
   h) Emit an episode (execution/step) with references to input envelope/data and output data.
5) Emit final run summary episode.

Any validation or policy failure MUST:
- write evidence,
- emit a **security_event episode** (and/or record via env.security_event_store_v1),
- return a stable error code.

---

## 6. Static handler registry (core mechanism)
Static mapping (v0):
- `noop` → noopHandler
- `http` → httpHandler (Node fetch, allowlist)
- `restricted_shell` → restrictedShellHandler (allowlist)
Optional:
- `mcp_proxy` → mcpProxyHandler

No other execution path exists.

---

## 7. Text channels (mandatory)
All text MUST be explicitly categorized:
- `human_ui`
- `model_instruction`
- `system_log`

No mixing. Any tool outputs must be treated as `system_log` (capped).

---

## 8. Minimalism guardrails (avoid “mini MCP”)
v0 MUST NOT include:
- approvals
- role-matrix orchestration
- pipeline transitions
- concurrency engine
- dynamic tool discovery

Formula:
**Plan envelope → deterministic interpreter (handlers) → episodes.**
