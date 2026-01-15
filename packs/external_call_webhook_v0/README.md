# External Call Webhook ProofKit (v0)

- Scope: noop-only webhook calls; dry-run enforced.
- Fixtures: `fixtures/pos/webhook_noop_request.json`, negative cases for forbidden target, missing target, oversize payload.
- Evidence: quality reports under `artifacts/quality/external_call_webhook_v0/(pos|neg)/<request_id>/runs/<run_id>/report.json`.
- Scripts: `quality:external_call_webhook`, `quality:external_call_webhook:neg` (see package.json).
