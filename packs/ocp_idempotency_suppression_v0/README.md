# OCP Idempotency & Suppression ProofKit (v0)

- Ensures duplicate sends are suppressed when the same idempotency key is reused with identical payload.
- Conflicts (same key, different payload) are rejected.
- Evidence-first: store keeps hashes + evidence refs only.
- Scripts: `quality:ocp_idempotency_suppression`, `quality:ocp_idempotency_suppression:neg`.
- Evidence: `artifacts/quality/ocp_idempotency_suppression_v0/(pos|neg)/<request_id>/runs/<run_id>/`.
