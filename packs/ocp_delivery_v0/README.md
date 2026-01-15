# OCP Delivery ProofKit Pack (v0)

- Purpose: noop-only delivery contract used by quality probes for `ocp.delivery.v0`.
- Fixtures:
  - `fixtures/pos/` contains a dry-run/noop request.
  - `fixtures/neg/` covers forbidden target, oversize payload, and missing-target schema.
- Evidence expectations:
  - Delivery runs write to `artifacts/ocp_delivery_v0/<request_id>/runs/<run_id>/`.
  - Quality probes write to `artifacts/quality/ocp_delivery_v0/(pos|neg)/<request_id>/runs/<run_id>/report.json`.
- Run suites:
  - Positive: `npm run quality:ocp_delivery`
  - Negative: `npm run quality:ocp_delivery:neg`
