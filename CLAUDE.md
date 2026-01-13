# MOVA Agent v0 — Operator Rules (Claude Code)

## Non-negotiable rules
1) **LLM is Planner only.** It must never execute tools directly.
2) **NO code generation** from plan. No "compile plan to mjs". Execution = interpreter + static handlers only.
3) All boundary artefacts must be **Ajv-validated**.
4) Every meaningful step must be recorded as **episodes**:
   - `ds.mova_episode_core_v1` for normal work
   - `ds.security_event_episode_core_v1` for security/policy/invalid cases
5) Strict text channel discipline:
   - `human_ui` for human output
   - `model_instruction` for prompts / LLM-only
   - `system_log` for technical logs (capped)
6) **Secrets never appear** in logs or evidence. Only presence/len is allowed.

## Repo truth sources
- MOVA reference (read-only): `vendor/MOVA/`
- Your agent runtime + CLI: this repo (tools/ + src/ + schemas/)

## Canonical CLI detection (must follow)
When you need to run the agent CLI, choose exactly one method:
1) If `npx mova-agent --help` works → use `npx mova-agent ...`
2) else if `tools/mova-agent.js` exists → use `node tools/mova-agent.js ...`
3) else stop and report: "CLI entrypoint not found".

Do not invent alternative runners.

## Default execution pattern
- Prefer `run-plan` (deterministic) when a plan file already exists.
- For a new goal:
  1) plan-only
  2) validate
  3) run-plan
  4) explain (optional, evidence-based)

## Definition of Done (DoD)
- Evidence directory path is produced
- `episodes/` contains valid episode JSON documents
- `quality:pos` and `quality:neg` pass when requested
- No prohibited commands were executed