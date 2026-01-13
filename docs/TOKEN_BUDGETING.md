# Token Budgeting

## Goal
Control and reduce token spend in MOVA Agent by:
- Precise auditing of token usage
- Output discipline (limit verbose output)
- Enforcing resource limits

## Architecture

### 1) Token budget contract
- File: `configs/token_budget.default.json`
- Schema: `schemas/ds.mova_token_budget_contract_v0.schema.json`
- Defines limits for:
  - Model calls
  - Input/output/total tokens
  - Cost in USD
  - Tool invocations
  - Console output size

### 2) Token metering
- Module: `src/telemetry/token_meter.ts`
- Collects usage statistics
- Tracks:
  - Input/output/total tokens
  - Cost
  - Provider/model
  - Cached tokens (if supported)

### 3) Budget enforcement
- Module: `src/telemetry/token_budget_enforcer.ts`
- Checks limits before operations
- Policy on exceed:
  - `fail` — abort execution
  - `warn` — warn and continue
  - `truncate_and_continue` — trim output and continue

### 4) Central logger
- Module: `src/logging/logger.ts`
- Levels: `quiet|info|debug`
- Strict output caps:
  - `MAX_STDOUT_BYTES`: 1024 bytes
  - `MAX_STDERR_BYTES`: 2048 bytes
- Full details go to artifacts; console prints only short messages

## Usage

### Run with custom budget
```bash
node build/tools/mova-agent.js --token-budget ./configs/custom_budget.json
```

### Environment variable
```bash
export MOVA_TOKEN_BUDGET_PATH=./configs/custom_budget.json
```

## Artifacts

### Token usage report
- File: `artifacts/<run_id>/token_usage.json`
- Detailed info per model call

### Resolved contract
- File: `artifacts/<run_id>/token_budget.resolved.json`
- Effective budget configuration

### Run summary
- File: `artifacts/<run_id>/run_summary.json`
- Fields:
  - `token_budget` — applied contract
  - `token_usage` — brief stats
  - `budget_status` — `passed|warned|failed`
  - `budget_violations` — list of violations

## Saving tokens
1. **Minimize console output** — only short statuses and artifact paths.
2. **Use refs** — prefer file references over embedding long text.
3. **Logging modes** — pick suitable verbosity.
4. **Limit hygiene** — review and tune limits regularly per workload.
