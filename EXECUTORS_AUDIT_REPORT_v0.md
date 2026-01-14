# Executors Audit Report v0

## Agent inventory (mova_agent)
- Drivers:  
  - `http` (`src/drivers/httpDriver.ts`): Node fetch; allowlist by host/protocol; timeout default 5000ms; caps via `context.limits.timeout_ms`; returns status/headers/body; dependencies: global `fetch` (undici polyfilled via node), no secrets by default.  
  - `restricted_shell` (`src/drivers/restrictedShellDriver.ts`): `execFile` wrapper with allowlist prefix match; timeout default 5000ms; returns stdout/stderr/exit_code; dependency: node `child_process`; no network; deny-by-default via empty allowlist.  
  - Registry (`src/drivers/index.ts`): noop built-in; registers http/restricted_shell; used by handlers/interpreter.
- Call sites: `src/handlers/registry.ts`, `src/interpreter/*.ts`, `skills/skills_layer.ts` (facts), CLI generation scaffold in sdk-cli.
- Policies/limits: allowlist + timeout; no size caps; no secrets baked in.
- Build: TypeScript → CJS (`tsc`); consumed via require; exports remain unchanged.
- Security defaults: deny destinations/commands when allowlist provided; otherwise permissive.

## Station inventory (read-only, mova_wf_cycle)
- Drivers/executors (JS/ESM):  
  - `executors/local_shell_v0/driver/driver_local_shell_v0.mjs`: offline shell driver with allowlist rule, returns stdout/stderr/evidence.  
  - `executors/opencode_server_v1/driver/driver_opencode_v1.mjs`: remote OpenCode engine over HTTP/SSE; requires docker, secrets optional; guarded by config.  
  - `executors/cloudflare_worker_gateway_v0/driver/driver_cf_gateway_v0.mjs`: remote gateway driver; requires wrangler secrets, R2, D1; deny-by-default via token.  
  - `executors/cloudflare_worker_v1/driver/driver_cloudflare_worker_v1.mjs`: stub (returns NOT_IMPLEMENTED).  
  - Routers: `executors/executor_router_v0/1.mjs` choose driver by ref.
- Guards: cloudflare/opencode require env vars and config; local_shell safe offline.
- Relevance to agent: only local_shell/http-style overlap; cloudflare/opencode are station-specific ops.

## Diff matrix (Agent vs Station)
- Shell: Agent `restricted_shell` (execFile allowlist) vs Station `local_shell_v0` (similar offline) → overlap, candidate for shared pkg.
- HTTP: Agent `http` driver (allowlist, timeout) vs Station none (uses fetch inside drivers) → candidate for shared pkg.
- Remote executors (cloudflare, opencode, gateway): present in Station only → excluded from v0.
- Router: Station has executor_router; Agent dispatches via handler registry → different, not extracted.

## Extraction scope v0 (@leryk1981/mova-executors)
- Include:  
  - Driver types/registry interface (minimal).  
  - `restricted_shell` driver (allowlist + timeout).  
  - `http` driver (allowlist + timeout; JSON/text normalize).  
  - Common result shape helpers (stdout/stderr/status/body).
- Exclude: cloudflare worker/gateway, opencode, deploy scripts, executor routers.

## Station comparison notes
- Cloudflare/OpenCode drivers are gated by env/config; remain station-only.
- local_shell_v0 parallels agent restricted_shell; can be mapped later via adapter.

## Evidence (commands)
- `rg -n "Driver|driver|execut(or|ors)|router|dispatch|run.*command|spawn|execa|fetch\\(|undici|http(s)?\\." src tools sdk-cli`
- `rg -n "restrictedShellDriver|httpDriver|cloudflare|wrangler|opencode" src tools`
- Station scan: `rg -n "executors/|driver_|executor_router|cloudflare|opencode|local_shell|wrangler|fetch(" .` (mova_wf_cycle, read-only)
