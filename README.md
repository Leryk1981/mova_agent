# MOVA Agent (TypeScript)

### Localization
Russian originals are kept in `docs/ru/`. This README and all docs are the English versions for the global community.

## Overview
Deterministic interpreter runtime for MOVA envelopes with strict typing, atomic evidence/episode writing, plugin driver registry, and CI/CD with Docker.

## Plugin Driver Registry
- Location: `src/drivers/index.ts`.
- API: `registerDriver(name, factory)`, `getDriver(name)`, `listDrivers()`.
- DriverContext supports `allowlist`, `limits`, `bindings`.
- Built-in drivers: `noop`, `http` (fetch with allowlist + timeout), `restricted_shell` (execFile with allowlist).

Example:
```ts
import { registerDriver } from './src/drivers';

registerDriver('my_driver', () => ({
  async execute(input) {
    return { ok: true, input };
  },
}));
```

## Linting & Formatting
```bash
npm run lint          # ESLint check
npm run format        # Prettier auto-format
npm run format:check  # Prettier check only
npm run check:structure  # Ensure .ts files stay in allowed folders
npm run check:docs       # Validate docs have headings (excluding docs/ru)
```

## Docker Build Verification
- Dockerfile: multi-stage on `node:18-alpine`, builds TS + generated types.
- Docker Compose: `docker-compose.yml` exposes port 3000.
- CI job `docker-build` builds `mova-agent:ci` and runs CLI help:
  `docker run --rm mova-agent:ci node build/tools/mova-agent.js --help`
- Local check:
  ```bash
  docker compose up --build
  curl http://localhost:3000/health
  ```

## SDK CLI
- Published package: `@leryk1981/mova-sdk-cli` (npm). Repo: `sdk-cli/` in this project.
- Install globally: `npm i -g @leryk1981/mova-sdk-cli`
- Quick use:
  ```bash
  mova init my-project                  # scaffold configs/episodes/plans
  mova plan -s env.mova_agent_plan_v1.json plans/plan.sample.json
  mova run plans/plan.sample.json       # local; add --endpoint <url> for MCP gateway
  mova driver:add http                  # generate/register driver skeleton
  mova policy:set --role admin --verb noop --allow
  mova episode:list --verb noop
  ```
- More details: `sdk-cli/README.md`, `sdk-cli/USAGE.md`.

## Scripts
- `npm run build` — compile to `build/`.
- `npm run gen:types` — generate `.d.ts` from JSON Schemas.
- `npm run lint` / `npm run format:check` — style checks.
- `npm test` — build + gen:types + unit tests (atomic writer, drivers).

## Documentation
- Architecture: `docs/MOVA_AGENT_ARCHITECTURE.md`
- Roadmap: `docs/MOVA_AGENT_ROADMAP.md`
- Production spec: `docs/prod_tz.md`
- Token budgeting: `docs/TOKEN_BUDGETING.md`
- Linting rules: `docs/linting.md`

## CI/CD
GitHub Actions: lint → format check → tests → docker-build. Node 18, npm ci.
