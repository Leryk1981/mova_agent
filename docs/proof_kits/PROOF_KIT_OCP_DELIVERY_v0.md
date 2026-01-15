# ProofKit: OCP Delivery v0

## Claim
Outbound delivery is policy-gated, deterministic, and produces auditable evidence artifacts.

## Surface (verb)
`ocp.delivery.v0` — single entry point for outbound delivery (currently noop-only dry-run).

## Policy (deny-by-default)
- Default: deny. Allow only when `ALLOW_NOOP_ONLY=true`.
- Driver gate: `driver_kind === noop_delivery_v0` and `dry_run === true`.
- Targets: forbid real endpoints (http/https); v0 accepts only noop-style targets.
- Payload guardrails: reject missing target and payloads exceeding the v0 byte cap.

## Determinism
- `result_core`: `{request_id, run_id, driver_kind, target, dry_run, delivered:false, status:'noop', driver_echo}`.
- All env/meta (timestamps, policy decision, driver echoes) live in evidence, not in `result_core`.
- Evidence directory is derived from request_id/run_id; driver output is echoed verbatim for audit only.

## Quality suites
- **pos**: dry-run/noop delivery passes; idempotent echoes and stable evidence paths.
- **neg**: deny without `ALLOW_NOOP_ONLY`; deny forbidden target; deny oversize payload; deny invalid schema (missing target).

## Evidence (artifacts)
- Delivery run: `artifacts/ocp_delivery_v0/<request_id>/runs/<run_id>/`
  - `request.json`, `result_core.json`, `driver_result.json`
- Quality reports:
  - Positive: `artifacts/quality/ocp_delivery_v0/pos/<request_id>/runs/<run_id>/report.json`
  - Negative: `artifacts/quality/ocp_delivery_v0/neg/<request_id>/runs/<run_id>/report.json`

## Out of scope / risks
- No real delivery (queues/retries/throttling/webhooks) in v0.
- Mixing run-specific metadata into `result_core` breaks determinism — keep it in evidence only.
- Real sends are forbidden until a non-noop policy/driver is introduced in v1.
