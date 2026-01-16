# MOVA Tool Door v0

## Overview

The MOVA Tool Door is a "wide door" approach to exposing various tools and services through a single, secure endpoint. Unlike traditional "narrow doors" that expose many specific endpoints, the Tool Door provides a unified interface at `POST /tool/:verb` that handles multiple types of operations through a standardized envelope.

## Architecture

### Single Endpoint
- **URL**: `POST /tool/:verb`
- **Verbs supported in v0**: `deliver`, `external_call`

### Universal MOVA Envelope (Request)
```json
{
  "policy_profile_id": "dev_local_v0",
  "env_ref": "optional_environment_reference",
  "request": {
    "target_url": "https://example.com/webhook",
    "message": "Hello, world!",
    "headers": {
      "Content-Type": "application/json"
    }
  },
  "context": {
    "user_id": "12345",
    "session_id": "abcde"
  },
  "idempotency_key": "unique-key-for-idempotency"
}
```

### Universal Receipt (Response)
```json
{
  "ok": true,
  "outcome_code": "DELIVERED",
  "evidence_ref": "uuid-of-evidence-record",
  "policy_trail_ref": "uuid-of-policy-decision",
  "result_core_hash": "sha256-hash-of-result"
}
```

## Outcome Codes

| Code | Description |
|------|-------------|
| `DELIVERED` | Deliver operation completed successfully |
| `EXTERNAL_CALL_OK` | External call completed successfully |
| `DUPLICATE_SUPPRESSED` | Request suppressed due to idempotency |
| `THROTTLED` | Request throttled based on policy |
| `POLICY_DENIED` | Request denied by policy |
| `BAD_REQUEST` | Malformed request |
| `UNAUTHORIZED` | Authentication failed |
| `RETRY_EXHAUSTED` | Operation failed after retries |
| `INTERNAL_ERROR` | Internal system error |

## Setup

### Prerequisites
- Cloudflare account with Workers enabled
- Wrangler CLI installed (`npm install -g wrangler`)
- D1 database provisioned

### Environment Variables & Secrets

#### Secrets (set with Wrangler)
```bash
wrangler secret put TOOL_DOOR_TOKEN
# Enter a strong authentication token
```

#### Policy Profiles
The policy profiles are bundled with the worker in `policies/tool_door/policy_profiles_v0.json`.

#### D1 Database Binding
Configure the D1 database binding in `wrangler.toml`:
```toml
[[d1_databases]]
binding = "TOOL_DOOR_DB"
database_name = "mova-tool-door-v0-db"
database_id = "your-database-id"
```

## Deployment

### Local Development
```bash
# Install dependencies
npm ci

# Run tests to ensure everything is working
npm run proofkit:all

# Start local development server
npm run cf:tool_door:dev
```

### Deploy to Cloudflare
```bash
# Deploy to development environment
npm run cf:tool_door:deploy:dev
```

### Smoke Testing
The smoke test is SKIP-by-default and requires environment variables:

```bash
# Set required environment variables
export TOOL_DOOR_URL="https://your-worker.your-subdomain.workers.dev"
export TOOL_DOOR_TOKEN="your-auth-token"
export TEST_WEBHOOK_URL="https://your-test-webhook-endpoint.com"

# Run smoke test
npm run smoke:tool_door:dev
```

## Policy Profiles

### dev_local_v0
- Allows: `deliver`, `external_call`
- Allowed hosts: `127.0.0.1`, `localhost`
- Throttle: Enabled, 60s cooldown, non-strict
- Retry: 2 attempts with 200ms, 800ms backoff

### prod_v0
- Allows: `deliver`, `external_call`
- Allowed hosts: [] (must be filled by operator)
- Throttle: Enabled, 60s cooldown, strict
- Retry: 3 attempts with 300ms, 1200ms, 3000ms backoff

## Features

### Authentication
- Requires `Authorization: Bearer <TOOL_DOOR_TOKEN>` header
- Denies all requests without valid token

### Policy Enforcement
- Verb-based authorization
- Host-based allowlisting
- Configurable via data-driven policy profiles

### Idempotency
- Prevents duplicate execution when `idempotency_key` is provided
- Stores results for replay on duplicate requests

### Rate Limiting & Throttling
- Configurable cooldown periods
- Strict vs non-strict modes
- Per-verb and per-host throttling

### Retry Logic
- Configurable retry attempts
- Exponential backoff scheduling
- Automatic retry on network errors and server errors (5xx, 429)

### Evidence & Audit Trail
- Full request/response logging (with sensitive data redacted)
- Policy decision tracking
- Cryptographic hashing of results