# OCP Delivery v1 ProofKit (local webhook send)

- Scope: real webhook send to local allowlist (127.0.0.1/localhost) with HMAC signing.
- Fixtures: `fixtures/pos/local_webhook_send_request.json` and negatives (missing secret, forbidden target, oversize payload).
- Evidence: runs under `artifacts/quality/ocp_delivery_v1/(pos|neg)/<request_id>/runs/<run_id>/`.
- Scripts: `quality:ocp_delivery_v1`, `quality:ocp_delivery_v1:neg`.

## Staging smoke (opt-in)
- Sends a real webhook only when env vars are set.
- Run: `npm run smoke:ocp_delivery:staging`.
- Required env vars: `OCP_STAGING_WEBHOOK_URL`, `OCP_STAGING_SIGNING_SECRET`.
- Evidence: `artifacts/smoke/ocp_delivery_staging/<run_id>/smoke_evidence.json`.

## Start here
1. `npm run ocp:doctor`
2. `npm run smoke:ocp_delivery:staging`
3. `npm run proofkit:run -- ocp_delivery_v1`

Doctor evidence: `artifacts/doctor/ocp_delivery/<run_id>/doctor_report.json`.
