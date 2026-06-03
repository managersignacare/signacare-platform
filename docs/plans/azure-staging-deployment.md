# Plan — Azure Windows Server staging deployment

## 1. Context

Pre-staging planning spike. Captures the deploy-shape decisions that must precede BUG-187/264 pool-config and subsequent operational bugs. Written so the pool numbers, TTLs, and secret plumbing choices are informed by concrete Azure SKU limits rather than tuned blind. Catalogues **BUG-365** (CI guard portability) + **BUG-366** (Azure config consolidation) as tracked work items with scope boundaries.

**Deploy target**: Azure Windows Server hosting the Signacare API (Node.js) + web SPA (static). Postgres via **Azure Database for PostgreSQL — Flexible Server** (managed PG). Redis via **Azure Cache for Redis**. Secrets in **Azure Key Vault**. Observability via **Azure Monitor + Application Insights**.

## 2. Deploy-shape decisions (must lock before BUG-187 pool numbers)

### 2.1 API runtime host

Three options reviewed, one recommendation:

| Option | Fit | Cost | Complexity |
|---|---|---|---|
| Azure App Service (Windows, Node) | Good; native Node support; Key Vault integration built-in | Medium | Low |
| Azure Container Apps | Best for multi-replica; k8s-ish; auto-scale | Medium-High | Medium |
| Azure VM (Windows Server + IIS reverse proxy) | Most control; matches "Windows Server" framing | High (patching burden) | High |

**Recommendation: Azure App Service (Windows).** Matches the "Windows Server" deploy target, has managed Node runtime, native Key Vault reference syntax in app settings, and PM2-equivalent process management (App Service handles worker process recycle). Avoids the IIS reverse-proxy complexity of raw VM hosting.

### 2.2 Postgres

**Azure Database for PostgreSQL — Flexible Server.**

Recommended SKU: **Standard_D2s_v3** (2 vCores, 8 GiB RAM) for staging — gives `max_connections = 859` default (per Azure docs for this SKU class). Production scales to `D4s_v3` or higher.

Key deployment details:
- **Port**: 5432 (Azure default; our `DB_PORT=5433` local-dev pin per CLAUDE.md §10 DOES NOT apply to Azure).
- **SSL**: required. `PGSSLMODE=require` in production env; certificate bundle bundled with `node-postgres`.
- **Connection pooling**: Azure offers optional **PgBouncer** sidecar (transaction-mode) on Flexible Server. Recommended: enable it, point `DB_HOST` at the PgBouncer endpoint (port 6432). This makes our application-level pool size tunable independently of Postgres `max_connections`.
- **`pg_hba.conf`**: not applicable (Azure-managed). Replace with firewall rules in the Azure portal.

**Pool-sizing math for BUG-187 (informs the actual commit):**
- Azure PG `max_connections` on D2s_v3 = 859; Flexible Server reserves ~15% for superuser/autovacuum = ~730 usable
- If using PgBouncer (recommended): pg-pool is effectively unbounded from the app's view; we cap the API-side pool
- API-side `appPool` (per pod): **conservative 10, hot cap 20** (matches Knex default of 10)
- `dbAdmin` pool (owner role, used for migrations + cross-tenant audit): **cap 5**
- `statement_timeout`: **30s** per transaction (matches `rlsMiddleware.ts:55` — already enforced locally); also enforce at Postgres parameter level as a defense in depth
- `idle_in_transaction_session_timeout`: **60s** — kills orphaned RLS transactions (prevents the BUG-187 exhaustion shape)
- `lock_timeout`: **5s** — deadlock detection
- `connect_timeout`: **10s** — fail fast on network partition

### 2.3 Redis

**Azure Cache for Redis — Basic C1 (1 GB)** for staging; **Standard C2** for production.

Key deployment details:
- **Port**: 6380 (SSL-only — Azure default) or 6379 (plain, Basic tier only)
- **SSL**: mandatory for Standard/Premium; optional for Basic (enable anyway)
- **Auth**: primary access key from Azure portal → Key Vault secret
- **Eviction policy**: canonical policy is `allkeys-lru` with bounded `maxmemory` (BUG-197 hardening). Set via Azure portal → Cache Configuration.
- Keys used: `jwt:blacklist:user:*` (7-day TTL), `csrf:*` (60 min), `idle:staffId` (session idle), `hibp:*` (24h cache — BUG-356 follow-up), plus session rate-limit keys.

### 2.4 Secrets: Azure Key Vault

All production secrets in Key Vault:
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL_MINUTES`, `JWT_REFRESH_TTL_DAYS`
- `DB_PASSWORD`, `DB_APP_PASSWORD`
- `REDIS_PASSWORD` (Azure primary access key)
- `SENTRY_DSN`, `OLLAMA_API_KEY` (if remote)
- `HPIO_MTLS_CERT`, `HPIO_MTLS_KEY` (NASH mTLS certs)
- `NPDS_CLIENT_SECRET`, eRx partner secrets

App Service references Key Vault via `@Microsoft.KeyVault(SecretUri=...)` syntax in application settings. No secrets in `.env` files in production.

Existing code: `apps/api/src/config/secrets.ts` already has a pluggable `SECRETS_BACKEND` mechanism. Add `SECRETS_BACKEND=azure_keyvault` + a resolver implementation.

### 2.5 Observability

**Azure Monitor + Application Insights**:
- Pino structured logs → stdout → App Service log stream → Log Analytics workspace
- Alert rules on log query: `kind=jwt_blacklist_fail_open` (BUG-356), `kind=tier_5_9_audit_write_failed` (BUG-360), `RLS transaction error` (BUG-187)
- Application Insights for request tracing + HTTP error rates

### 2.6 CI/CD

GitHub Actions → Azure App Service deploy. CI runners are Linux (ubuntu-latest) — our bash CI guards work. **Windows concern is about DEPLOY target, not CI runner.** BUG-365 (CI guard portability) therefore ONLY matters if we later use Windows self-hosted runners for on-prem builds.

## 3. Catalogued work items

### BUG-365 — CI guard portability audit (defer until Windows CI runner is needed)

**Severity**: S3 (tech-debt; not a deploy blocker)
**Scope**: audit which of the 18 CI guards use bash-only features (`grep`, `sed`, `awk`, pipes) vs which could run under PowerShell or Node. Port the critical ones to Node if/when a Windows-native CI runner is introduced.

**Current state**: `.github/workflows/*.yml` uses `ubuntu-latest`. All 18 guards run on Linux. No immediate action required.

**Unblock criterion**: decision to add a Windows self-hosted runner. Until then, defer.

### BUG-366 — Azure production config consolidation

**Severity**: S2 (deploy blocker)
**Scope**: ship a `.env.production.template` + Azure-aware config loader that:
1. Pulls secrets from Azure Key Vault when `SECRETS_BACKEND=azure_keyvault`
2. Sets `DB_PORT=5432` (not our local 5433)
3. Sets `PGSSLMODE=require` + bundles the Azure PG CA cert
4. Sets `REDIS_TLS=true` + `REDIS_PORT=6380`
5. Sets `statement_timeout`, `idle_in_transaction_session_timeout`, `lock_timeout` as session parameters via `rlsMiddleware` (already 30s for statement_timeout — confirm the others)
6. Validates at boot that all Key Vault references resolve (fail fast if Key Vault permissions wrong)

**Files to add/edit**:
- `apps/api/.env.production.template` (new) — documented template showing Key Vault reference syntax
- `apps/api/src/config/secrets.ts` — add `azure_keyvault` backend (`@azure/keyvault-secrets` + `@azure/identity`)
- `apps/api/src/db/db.ts` — SSL config for Azure PG, pool size from env, statement_timeout confirmation
- `apps/api/src/middleware/rlsMiddleware.ts` — add `idle_in_transaction_session_timeout` + `lock_timeout` SET LOCAL calls
- `docs/deploy/azure-staging-runbook.md` (new) — step-by-step deploy runbook referencing this plan

**Tests**:
- Unit test for the Azure Key Vault resolver (mock `@azure/identity`)
- Integration test: confirm `SET LOCAL statement_timeout='30s'` fires in rlsMiddleware
- Smoke test: boot with invalid Key Vault URI → assertAiDataResidency-style fail-fast

**Gate**: L1-L3 (CI + code review). L4/L5 optional (config/docs only; no clinical-code path).

**Split**: ship BUG-366 in 2 commits
- (a) Azure Key Vault secrets-backend + `.env.production.template` (apps/api/src/config/secrets.ts + template)
- (b) DB pool + session timeouts (apps/api/src/db/db.ts + rlsMiddleware.ts) — this COMBINES with BUG-187/264 since the pool config IS the BUG-187 fix

## 4. Next commit sequence (updated priority)

| # | Commit | Notes |
|---|---|---|
| 1 | BUG-366a — Azure Key Vault backend + `.env.production.template` | Non-risky-class (config only); L1-L3 |
| 2 | **BUG-187 + BUG-264 + BUG-366b combined** — DB pool sizing + statement_timeout + idle_in_transaction_session_timeout + lock_timeout, Azure-aware | Risky-class; L1-L5; TDD via dbPoolPressure existing test (currently in bughunt/ subdir — BUG-033 made it discoverable) |
| 3 | BUG-262 — HL7 ORU^R01 persistence | Risky-class; L1-L5 |
| 4 | BUG-288 — audit_log partitioning | Risky-class; L1-L5 |
| 5 | BUG-353 redo — force-logout trigger (now unblocked by BUG-356) | Risky-class; L1-L5 |
| 6 | BUG-365 — DEFERRED (Windows CI runner not in scope) | catalogue only |

## 5. Deploy-time checklist (not code; for the human running the deploy)

- [ ] App Service created (Windows, Node 20+)
- [ ] Azure PG Flexible Server created (D2s_v3 staging; backup window 02:00-04:00 UTC)
- [ ] PgBouncer sidecar enabled (transaction mode)
- [ ] Azure Cache for Redis created (Basic C1 staging); eviction policy set to `allkeys-lru`
- [ ] Key Vault created; managed identity granted `Key Vault Secrets User` role
- [ ] Secrets seeded: JWT, DB, Redis, Sentry, NASH mTLS, eRx
- [ ] App Service application settings reference Key Vault secrets via `@Microsoft.KeyVault(...)` syntax
- [ ] App Service firewall rules allow: Azure PG, Azure Redis, outbound to ADHA + NASH + PBS endpoints (document IP ranges)
- [ ] GitHub Actions OIDC federation configured (no long-lived deploy secrets in GH)
- [ ] Application Insights connected; log-based alerts configured for BUG-356/360 tags
- [ ] Migrations ledger check: `SELECT COUNT(*) FROM knex_migrations` → matches local count (currently 44 batches)
- [ ] Staging seed applied (non-PHI test data)
- [ ] Smoke tests: login + /health/ready + /api/v1/patients?limit=1 + /api/v1/fhir/metadata

## 6. Out of scope for this plan

- Production-grade HA (multi-region, geo-replicated PG) — staging is single-region
- Auto-scale rules beyond App Service default — tune post-load-test
- CDN in front of the web SPA — post-GA
- Backup/restore drills — operational doc not engineering plan
- VPN / Private Link for PG — consider for production, not staging
