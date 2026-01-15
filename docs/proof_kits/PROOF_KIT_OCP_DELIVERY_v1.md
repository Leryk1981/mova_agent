# ProofKit: OCP Delivery v1 (local webhook send)

## Claim
Outbound delivery can perform a real webhook call (local-only), is policy-gated, deterministic, signed, and produces auditable evidence.

## Surface
`ocp.delivery.v1` — webhook POST with HMAC signing to an allowlisted local endpoint.

## Policy (deny-by-default)
- Allow real send only when both `policy.allow_real_send === true` and `OCP_ENABLE_REAL_SEND=1`.
- Allowlist target host: `127.0.0.1` or `localhost` only.
- Reject missing signing secret (`WEBHOOK_SIGNING_SECRET`), oversize payloads, or forbidden targets.
- Enforce hard timeout (5s) and deterministic errors.

## Determinism
- `result_core`: `{request_id, run_id, driver_kind, target_url, delivered, status_code?, dry_run:false}`.
- Run-specific data (timestamps, hashes, latency, policy decision, response body hashes) lives in evidence artifacts.

## Evidence
- Per run: `artifacts/ocp_delivery_v1/<request_id>/runs/<run_id>/`
  - `request.json` (resolved request)
  - `result_core.json`
  - `evidence.json` (policy decision, target host, request hash, body sha256, response status/body hash, timings)

## Quality suites
- **pos**: local webhook server verifies HMAC with `test_secret_v1`, returns 200; run passes with evidence written.
- **neg**: missing secret, forbidden target, oversize payload all fail deterministically (policy/validation).

## Signing
- Headers: `x-mova-ts`, `x-mova-body-sha256`, `x-mova-sig` (HMAC-SHA256 over `${ts}.${body_sha256}` with shared secret).

## Out of scope
- Non-local endpoints, retries/queues/backoff, multi-attempt delivery, auth tokens beyond HMAC header.
