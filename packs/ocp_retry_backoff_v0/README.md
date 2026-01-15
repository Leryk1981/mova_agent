# OCP Retry & Backoff ProofKit (v0)

- Verifies deterministic retry/backoff handling for webhook delivery.
- Covers flaky HTTP 500s and timeouts before a final success, plus non-retryable failures.
- Scripts: `quality:ocp_retry_backoff`, `quality:ocp_retry_backoff:neg`.
- Evidence: `artifacts/quality/ocp_retry_backoff_v0/(pos|neg)/<request_id>/runs/<run_id>/`.
