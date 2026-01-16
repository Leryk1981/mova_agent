# ProofKit: OCP Rate Limit & Throttle v0

## Claim
Outbound delivery enforces deterministic cooldown-based throttling, policy-gated, with rate-limit evidence.

## Surface
`ocp.delivery.v1` with policy profile `ocp_delivery_dev_local_throttle_v0`.

## Policy
- rate_limit.enabled true with cooldown_ms 60000.
- strict false for pos; strict true for neg via runner override.
- allowlist includes localhost/127.0.0.1.
- require_hmac true; timeout and max_payload_bytes enforced.

## Determinism
- Key = target URL host + path (no query) + driver_id if present.
- No jitter, no timers; pure cooldown check.

## Evidence
- `evidence.json` includes `rate_limit` block with key, last_sent_ms, remaining_ms, allowed.
- Quality reports: `artifacts/quality/ocp_rate_limit_throttle_v0/(pos|neg)/<request_id>/runs/<run_id>/`.

## Quality suites
- **pos**: two sends back-to-back; second soft-throttled (ok=true); server sees 1 request.
- **neg**: strict throttle; second returns THROTTLED_STRICT (ok=false); server sees 1 request.
