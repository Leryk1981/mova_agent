# ProofKit: OCP Delivery v1 (local webhook send)

## Claim
Outbound delivery can perform a real webhook call (local-only), is policy-gated, deterministic, signed, and produces auditable evidence.

## Surface
`ocp.delivery.v1` — webhook POST with HMAC signing to an allowlisted local endpoint.

## Policy (deny-by-default)
- Allow real send only when `policy.allow_real_send === true` and `OCP_ENABLE_REAL_SEND=1`.
- Allowlist target host from policy profile (dev/staging/prod).
- Reject missing signing secret, oversize payloads, forbidden targets; enforce timeout.

## Determinism
- `result_core`: `{request_id, run_id, driver_kind, target_url, delivered, status_code?, dry_run:false}`.
- Run-specific data (timestamps, hashes, latency, policy decision, response body hash) stays in evidence.

## Evidence
- `artifacts/ocp_delivery_v1/<request_id>/runs/<run_id>/`
  - `request.json`, `result_core.json`, `evidence.json` (policy profile id, decision, hashes, timings).

## Quality suites
- **pos**: local webhook server validates HMAC secret `test_secret_v1`, returns 200; evidence written.
- **neg**: missing secret, forbidden target, oversize payload, non-local target all fail deterministically.

## Signing
- Headers: `x-mova-ts`, `x-mova-body-sha256`, `x-mova-sig` where `sig = HMAC(ts + '.' + body_sha256)`.

## Out of scope
- Non-local endpoints, retries/queues/backoff, multi-attempt delivery, auth tokens beyond HMAC header.
