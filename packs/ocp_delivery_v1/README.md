# OCP Delivery v1 ProofKit (local webhook send)

- Scope: real webhook send to local allowlist (127.0.0.1/localhost) with HMAC signing.
- Fixtures: `fixtures/pos/local_webhook_send_request.json` and negatives (missing secret, forbidden target, oversize payload).
- Evidence: runs under `artifacts/quality/ocp_delivery_v1/(pos|neg)/<request_id>/runs/<run_id>/`.
- Scripts: `quality:ocp_delivery_v1`, `quality:ocp_delivery_v1:neg`.
