# MOVA_AGENT_ROADMAP_v0.md
## Goal
A strong coding model should be able to implement the whole project “from A to Z”
using:
- these three spec files (the brief),
- the vendored MOVA 4.1.1 repo for reference,
- standard Node tooling.

No station tooling is assumed. Everything must be built fresh.

---

## Phase 0 — Project bootstrap (skeleton)
Deliver:
- repo skeleton as defined in TZ
- package.json with scripts:
  - build (optional)
  - test
  - quality:pos
  - quality:neg
- gitignore for artifacts
- vendor/MOVA clone present

Exit:
- `npm test` runs (even if empty)
- schema loader can locate MOVA schemas in vendor/MOVA

---

## Phase 1 — Ajv loader + schema wiring
Deliver:
- Ajv loader loads:
  - MOVA red core schemas (by file path in vendor/MOVA)
  - project schemas in /schemas
- validation helper that prints readable errors

Exit:
- validating a provided `ds.connector_core_v1` sample and a provided `ds.mova_episode_core_v1` sample succeeds

---

## Phase 2 — Product-layer schemas (request/plan/tool_pool/step)
Deliver:
- env.mova_agent_request_v1
- env.mova_agent_plan_v1
- ds.mova_agent_step_v1
- ds.mova_agent_tool_pool_v1 (embedding ds.connector_core_v1 + bindings)
- ds.mova_agent_run_summary_v1
- ds.mova_agent_validation_report_v1

Exit:
- fixtures in docs/examples/pos validate
- fixtures in docs/examples/neg fail as expected

---

## Phase 3 — Interpreter core + evidence/episodes (NO LLM)
Deliver:
- interpreter runPlan (sequential)
- handler registry + handlers:
  - noop
  - http (fetch allowlist)
  - restricted_shell (allowlist)
- evidence writer + episode writer

Exit:
- `run-plan` executes pos plan and emits valid episodes
- evidence layout matches TZ exactly

---

## Phase 4 — Policy enforcement + security episodes (deny-by-default)
Deliver:
- instruction profile loading and enforcement
- stable error taxonomy mapping to security events
- negative suite:
  - tool denied
  - destination denied
  - schema invalid
  - timeout

Exit:
- `quality:neg` PASS proves actual denies and security episodes exist

---

## Phase 5 — Skills (planner/repair/explain)
Deliver:
- planner adapter stub (LLM integration can be mocked)
- repair behavior using Ajv errors
- explain output strictly from evidence

Exit:
- full-cycle works end-to-end
- invalid plans never execute; they become repair/refusal evidence

---

## Phase 6 — UX stabilization (commands)
Deliver:
- CLI commands: plan, run-plan, run, rerun, open-evidence
- consistent human_ui output

Exit:
- user can run the whole flow with one command and always gets evidence path

---

## Phase 7 — One real scenario integration (dry-run default)
Deliver:
- tool pool for one domain (minimal)
- demo plan example
- policy requires explicit profile to enable “real side effects”

Exit:
- dry-run demo works; real run is opt-in by profile and secrets presence
