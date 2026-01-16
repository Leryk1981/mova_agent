# OCP Rate Limit & Throttle ProofKit (v0)

- Verifies deterministic cooldown-based throttling for OCP delivery v1.
- Covers soft throttle (ok=true) and strict throttle (ok=false) outcomes.
- Scripts: `quality:ocp_rate_limit_throttle`, `quality:ocp_rate_limit_throttle:neg`.
- Evidence: `artifacts/quality/ocp_rate_limit_throttle_v0/(pos|neg)/<request_id>/runs/<run_id>/`.
