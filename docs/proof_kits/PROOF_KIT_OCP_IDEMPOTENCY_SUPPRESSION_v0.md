# ProofKit: OCP Idempotency & Suppression v0

## Claim
Outbound delivery suppresses duplicate sends for the same idempotency key, detects conflicts, and produces evidence-first records.

## Surface
`ocp.delivery.v1` with `idempotency_key` in request; suppression happens before actual send.

## Policy
- Suppression is on when `idempotency_key` is provided.
- Conflicts (same key, different payload hash) are denied with deterministic error.

## Determinism
- `result_core` includes status codes: `SUPPRESSED_DUPLICATE` or `IDEMPOTENCY_CONFLICT` as applicable.
- Evidence records original evidence path and hashes; store holds hashes only.

## Evidence
- Delivery runs: `artifacts/ocp_delivery_v1/<request_id>/runs/<run_id>/` with `result_core.json` and `evidence.json`.
- Idempotency store: `artifacts/ocp_idempotency_store_v0/store.json` (hashes + evidence refs).
- Quality: `artifacts/quality/ocp_idempotency_suppression_v0/(pos|neg)/<request_id>/runs/<run_id>/`.

## Quality suites
- **pos**: first send delivers; repeat with same key/payload is suppressed; mock receives 1 call total.
- **neg**: missing key → `MISSING_IDEMPOTENCY_KEY`; same key different payload → `IDEMPOTENCY_CONFLICT`.

## Out of scope
- Distributed store, expiration, cleanup; v0 is single-node file-based.
