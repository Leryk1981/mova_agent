# MOVA Agent — Production-Grade Competitor (Spec)
*(intended for a team of 4–5 engineers, QA, and DevOps)*

---

## 1. Project Goals
| # | Goal | Definition of Ready |
|---|------|----------------------|
| 1 | Achieve full static typing (TypeScript) | 100% of source files are `.ts`, no duplicate `.js`. |
| 2 | Ensure atomic and reliable episode/evidence writes | Write to a transactional file + backup, add failure tests. |
| 3 | Implement extensible driver registry (plugin model) | API `registerDriver(name, factory)` and dynamic load from `drivers/`. |
| 4 | Enforce strict policy and token budget | `policy_engine` checks RBAC, rate-limit, budget; test coverage ≥ 90%. |
| 5 | CI/CD with full test coverage | GitHub Actions: lint → unit → integration → build → Docker image. |
| 6 | Provide official SDKs (TS & Python) and MCP-gateway | Publish npm & PyPI packages, usage examples. |
| 7 | Provide scalable production infrastructure | Docker Compose + Helm charts, auto-scaling, monitoring. |

---

## 2. Current State (from repository audit)

| Component | Current impl | Issues |
|-----------|--------------|--------|
| **Codebase** | Duplicate `.js` + `.ts`, core modules in `src/*`. | No strict typing, potential drift. |
| **Validation** | `src/ajv/ajv_loader.{js,ts}` — manual schema loading, `Ajv` without typed generation. | Low performance, no compile-time checks. |
| **Episodes** | `src/episodes/episode_writer*` writes JSON directly. | No atomicity, risk of data loss on crash. |
| **Handlers** | `src/handlers/registry.{js,ts}` — static mapping. | Adding a driver requires code change + restart. |
| **Policy** | `src/policy/policy_engine.{js,ts}` — basic checks. | No RBAC, rate-limit, token-budget support. |
| **Token budget** | `src/telemetry/*` — partial checks, not schema-bound. | No strict schema validation or reporting. |
| **CLI** | `src/ux/cli_interface.{js,ts}` outputs `human_ui`. | No unified logging, mixed channels. |
| **Tests** | Many unit tests, limited integration coverage. | No end-to-end (plan → interpreter → episodes). |
| **CI/CD** | Missing. | No automated checks or Docker build. |
| **Docs** | `README.md`, `MOVA_AGENT_ARCHITECTURE_v0.md` descriptive only. | No API docs or SDK examples. |

---

## 3. Requirements

### 3.1 Functional
1. **Full TypeScript migration**  
   - Remove all `.js`, keep only `.ts`.  
   - Configure `tsconfig` (target ES2022, strict, noImplicitAny).  

2. **Generate types from JSON Schema**  
   - Use `json-schema-to-typescript`.  
   - Script `npm run gen:types` → `src/types/generated/*.d.ts`.  

3. **Atomic episode writes**  
   - Write to temp file `*.tmp.json` → `fs.renameSync`.  
   - Add backup dir `episodes/_backup`.  

4. **Plugin driver model**  
   - Directory `src/drivers/` with `index.ts` exporting `registerDriver`.  
   - API: `registerDriver(name: string, driverFactory: () => Driver)`.  
   - Dynamic import (`import()`) on first use.  

5. **Extended policy engine**  
   - Roles (`admin, user, service`).  
   - Rate-limit and token-budget (from `schemas/ds.mova_token_budget_contract_v0.schema.json`).  
   - Policy described in `configs/instruction_profile.default.json`.  

6. **CI/CD**  
   - GitHub Actions: `lint`, `test`, `build`, `docker`.  
   - Dockerfile (multi-stage): build TS → `node:18-alpine`.  
   - Docker Compose for local dev (agent + PostgreSQL for logs).  

7. **SDK**  
   - **npm** package `mova-agent-sdk` (TypeScript).  
   - **Python** package `mova-agent-sdk-py` (pydantic models, HTTP client).  

8. **MCP-gateway**  
   - Express server (`mcp-gateway/index.ts`) → JWT auth, route `/tools/:toolId`.  
   - Proxy calls to MOVA Agent via REST (POST `/run`).  

9. **Monitoring**  
   - Prometheus metrics (`process_cpu_seconds_total`, `agent_requests_total`).  
   - Loki/Grafana for logs.  

### 3.2 Non-functional
| Requirement | Target |
|-------------|--------|
| **Performance** | < 10 ms schema validation, < 50 ms per step (no I/O). |
| **Reliability** | 99.9% success for episode writes, auto recovery from backup. |
| **Security** | JWT signing, CSP, injection protection in `restricted_shell`. |
| **Scalability** | Horizontal scale via k8s (stateless). |
| **Logs/Tracing** | Full fields per `global.text_channel_catalog_v1.json`. |
| **Compatibility** | Node ≥ 18, TypeScript ≥ 5.0, Windows/Linux/macOS. |

---

## 4. Architecture (text)

```
+-------------------+          +-------------------+          +-------------------+
|   CLI / UI        |  <----> |   REST API (MCP) |  <---->  |   Agent Core      |
| (src/ux)          |          | (Express)         |          | (interpreter)    |
+-------------------+          +-------------------+          +-------------------+
        ^                            ^                               |
        |                            |                               |
        |   +------------------------+-------------------------------+
        |   |                        |                               |
        v   v                        v                               v
+-------------------+   +-------------------+   +-------------------+
|  Policy Engine    |   |  Driver Factory   |   |  Episode Writer   |
| (src/policy)      |   | (src/drivers)    |   | (src/episodes)   |
+-------------------+   +-------------------+   +-------------------+
        ^                        ^                         ^
        |                        |                         |
        |   +--------------------+-------------------------+
        |   |                                          |
        v   v                                          v
+-------------------+   +-------------------+   +-------------------+
|  Ajv Schema Loader|   |  Token Budget    |   |  Logging (global) |
| (src/ajv)         |   | (src/telemetry) |   | (src/logging)     |
+-------------------+   +-------------------+   +-------------------+
```

- **CLI/UX** collects input, forms `env.mova_agent_request_v1`.  
- **MCP-gateway** authenticates and proxies to core.  
- **Policy Engine** enforces role, rate-limit, token-budget.  
- **Driver Factory** dynamically loads drivers (http, shell, db, mcp_proxy).  
- **Interpreter** executes steps, uses AJV validators.  
- **Episode Writer** atomically stores episodes/evidence.  
- **Logging** writes to `human_ui`, `model_instruction`, `system_log`.  

---

## 5. Work Plan (sprints)

| Sprint | Duration | Tasks | Deliverable |
|--------|----------|-------|-------------|
| **S1** | 2 weeks | TS-only code; setup `tsconfig`, `eslint`, `prettier`; remove `.js`. | Clean TS repo, `npm run build`. |
| **S2** | 2 weeks | Type generation from schemas; CI integration (`npm run gen:types`). | `src/types/generated/*.d.ts` committed. |
| **S3** | 3 weeks | Atomic episode writer + backups; failure tests. | Reliable `episode_writer`. |
| **S4** | 3 weeks | Plugin drivers (`src/drivers`); implement PostgreSQL & GraphQL drivers. | Dynamic driver loading. |
| **S5** | 3 weeks | Full `policy_engine` (RBAC, rate-limit, token-budget); coverage ≥ 90%. | Hardened policy layer. |
| **S6** | 2 weeks | CI/CD (GitHub Actions) + Dockerfile; Docker Compose for local dev. | Automated build & test. |
| **S7** | 2 weeks | MCP-gateway (JWT, routes); SDK (npm + PyPI). | Public APIs/SDKs. |
| **S8** | 2 weeks | Monitoring (Prometheus + Loki); Helm charts. | Prod-ready deploy. |
| **S9** | 1 week | Final docs (API, SDK, deployment); training. | Complete documentation set. |
| **Total** | **20 weeks** (~5 months) |  |

---

## 6. Resources & Budget

| Role | Person-weeks | Salary (RUB) | Est. cost |
|------|--------------|--------------|-----------|
| Senior TS Engineer | 8 | 200 000 | 1 600 000 |
| Backend Engineer (Node/Go) | 6 | 180 000 | 1 080 000 |
| Security Engineer | 4 | 220 000 | 880 000 |
| QA Engineer | 5 | 150 000 | 750 000 |
| DevOps Engineer | 3 | 190 000 | 570 000 |
| Technical Writer | 2 | 130 000 | 260 000 |
| **Total** | **28** | — | **≈ 5 500 000 RUB** |

Includes infra prep, licenses (npm/PyPI), cloud test resources (AWS/GCP).

---

## 7. Acceptance Criteria (DoD)

| # | Criterion |
|---|-----------|
| 1 | Full test suite (unit + integration) covers ≥ 90% of code. |
| 2 | Docker image < 150 MB, starts cleanly. |
| 3 | API gateway passes security tests (OWASP ZAP). |
| 4 | Generated SDK published to npm & PyPI; sample project passes CI. |
| 5 | Docs cover architecture, API, startup guide, monitoring. |
| 6 | Performance: < 10 ms schema validation, < 50 ms step execution. |
| 7 | Logs/metrics integrated with Grafana/Loki. |
| 8 | Deployable to k8s via Helm chart without manual edits. |

---

## 8. Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **TS migration complexity** | Medium | Medium | Phased migration, test coverage before refactor. |
| **Unexpected schemas** | Low | High | Auto type generation + schema tests. |
| **Driver security** | Medium | High | Command allowlist, sandbox for `restricted_shell`. |
| **Staffing gaps** | Low | Medium | Pull external security/CI consultants. |
| **MCP-gateway stability** | Medium | Medium | Integration tests with load simulation. |

---

## 9. Conclusion
This spec defines a stepwise plan to turn **MOVA Agent** into a production-grade product ready for enterprise scenarios with strict security, audit, and determinism. Completing all items positions us to compete in the on-prem intelligent agent space with open architecture, full traceability, and flexible MCP integration.

**Next step:** align sprint plan with the team, create backlog in Jira/ClickUp, start Sprint 1 – TypeScript migration.
