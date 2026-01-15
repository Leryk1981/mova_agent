# ProofKit: OCP Retry & Backoff v0

## Claim
Outbound delivery retries deterministically on retryable failures, without jitter, and records attempt evidence.

## Surface
`ocp.delivery.v1` with retry/backoff enabled via policy profile `ocp_delivery_dev_local_retry_v0`.

## Policy
- Retry only when policy.retry_enabled is true.
- Allowlist: localhost/127.0.0.1 in dev-local retry profile.
- require_hmac true; timeout and max_payload_bytes enforced per policy.

## Determinism
- Backoff schedule: `min(max_backoff_ms, base_backoff_ms * 2^(attempt-1))`, no jitter.
- attempt logs contain status, http_status/error_code, planned_backoff_ms.
- outcome codes: DELIVERED, RETRY_EXHAUSTED, NON_RETRYABLE_HTTP_STATUS, NETWORK_ERROR.

## Evidence
- Run directory: `artifacts/ocp_delivery_v1/<request_id>/runs/<run_id>/` with `evidence.json` containing attempts[] and policy_profile_id.
- Quality reports: `artifacts/quality/ocp_retry_backoff_v0/(pos|neg)/<req_id>/runs/<run_id>/`.

## Quality suites
- **pos**: flaky endpoint returns 500 twice then 200; timeout once then 200; expect delivered with attempts_total 3 and 2.
- **neg**: 400 should not retry; 500 always leads to retry exhausted with max attempts.

## Out of scope
- Jitter, adaptive backoff, exponential caps per target; v0 is deterministic for CI.
