# 08 — Deployment Guide (Gold Standard)

**Last refreshed:** 2026-04-14 (env var matrix, queues + CI guards updated for Phases 10–12; procedural content is unchanged from 2026-04-11).

Production-grade deployment reference for Signacare. This guide is the
authoritative deployment runbook — if it's not in this file or linked from
it, it should be added before go-live.

## 1. Environments

| Env | Purpose | DB | Redis | Secrets source |
|---|---|---|---|---|
| `local` | Developer | local Postgres | local Redis | `apps/api/.env` |
| `ci` | GitHub Actions | docker postgres | docker redis | secrets store |
| `staging` | Pre-production | managed Postgres + backups | managed Redis | Vault / AWS SM |
| `production` | Live | managed Postgres 15+ w/ replica | managed Redis w/ persistence | Vault / AWS SM |

## 2. Required infrastructure (production)

| Component | Version / size | Notes |
|---|---|---|
| Node.js | 20 LTS | PM2 cluster mode, one worker per core |
| Postgres | 15+ | `pgcrypto` + FTS enabled; partitioning requires PG 12+ |
| Redis | 7+ | AOF persistence; separate DBs for rate-limit, sessions, BullMQ |
| nginx | 1.24+ | TLS termination + static SPA hosting |
| Object storage | S3 / MinIO | For audio + attachments; server-side encryption on |
| SMTP relay | — | For outbound email |
| Sentry / Datadog / NewRelic | — | Optional but recommended |

### Postgres role model

```sql
-- superuser / owner (migrations only, creds in Vault)
CREATE ROLE signacare_owner WITH LOGIN PASSWORD '<vault>';

-- runtime role (API container connects as this)
CREATE ROLE app_user WITH LOGIN PASSWORD '<vault>';

-- app_user must NOT have UPDATE/DELETE/TRUNCATE on audit_log or children
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_user;
-- ... and every audit_log_y* child partition
```

### Redis DB layout

| DB | Purpose |
|---|---|
| 0 | BullMQ queues |
| 1 | Rate limit counters |
| 2 | Idempotency keys |
| 3 | Session idle windows |

### BullMQ queue allowlist

The `jobBus` enforces a runtime allowlist — a stray `addJob('sms', …)` throws
immediately. The allowed queues are:

`email`, `ai`, `llm`, `flag`, `hl7-outbound`, `hl7-inbound`, `outlook`,
`session-cleanup`, `ocr`, `mh-expiry`, **`notification`** (Phase 10),
**`patient-outreach`** (Phase 12), `test-queue` (tests only).

Adding a new queue requires editing `apps/api/src/shared/jobBus.ts` AND
documenting it in `docs/fix-registry.md`.

## 3. Environment variables (critical subset)

```env
NODE_ENV=production
PORT=4000
API_BASE_URL=https://api.example.com

# Postgres (must be the runtime role, not owner)
DB_HOST=...
DB_PORT=5432
DB_USER=app_user
DB_PASSWORD=<vault>
DB_NAME=signacaredb
DB_APP_USER=app_user      # used by audit immutability test

# Postgres migration role (only used by the migration job)
DB_MIGRATION_USER=signacare_owner
DB_MIGRATION_PASSWORD=<vault>

# JWT
JWT_ACCESS_SECRET=<32+ bytes from /dev/urandom>
JWT_REFRESH_SECRET=<32+ bytes from /dev/urandom>
JWT_ACCESS_TTL_MINUTES=15
JWT_REFRESH_TTL_DAYS=14

# Redis
REDIS_URL=rediss://...

# Session
SESSION_IDLE_MINUTES=30

# CORS
CORS_ORIGIN=https://app.example.com

# Feature flags / AI
LLM_PROVIDER=openai|anthropic|azure
LLM_API_KEY=<vault>
SCRIBE_HALLUCINATION_STRICT=true

# Observability
SENTRY_DSN=https://...

# ── Phase 10 notifications ──────────────────────────────────────
# (No new env vars — reuses the existing Redis BullMQ instance.)

# ── Phase 11A/B mobile sync + FCM ───────────────────────────────
FCM_SERVICE_ACCOUNT_PATH=/secrets/fcm-service-account.json
APNS_KEY_PATH=/secrets/AuthKey_<KEY_ID>.p8
APNS_TEAM_ID=<Apple Dev Team ID>
APNS_KEY_ID=<APNs key id>
# Note: FCM + APNs are optional at runtime. If FCM_SERVICE_ACCOUNT_PATH is
# unset, fcmService falls back to no-op mode and the mobile apps degrade
# to the 60s foreground polling loop. Push is a courtesy layer, never
# the source of truth.

# ── Phase 12 patient outreach / ACS SMS ─────────────────────────
ACS_CONNECTION_STRING=<Azure Communication Services connection string>
ACS_FROM_PHONE=<+61...>
DEFAULT_MONTHLY_SMS_BUDGET_USD=50
# ACS is locked to apps/api/src/integrations/acs/** and callable only from
# patientOutreachService (enforced by the acs-callers CI guard). Leave
# ACS_CONNECTION_STRING unset in deployments that don't use patient SMS.

# ── Child-process hardening (WHISPER_PYTHON, etc.) ──────────────
# Optional absolute-path pins for binaries the API spawns. Required on
# macOS dev boxes with multiple python3 installs. Linux containers can
# leave them unset — the shared binaryResolver walks /opt/homebrew,
# /usr/local, /usr/bin, /bin in order.
# WHISPER_PYTHON=/usr/bin/python3
# PG_DUMP_PATH=/usr/bin/pg_dump
# GZIP_PATH=/bin/gzip
# OLLAMA_PATH=/usr/local/bin/ollama
```

**Secrets discipline** (CLAUDE.md §6.2): no fallback values. Missing secrets must throw at startup — **never** silently use a default.

## 4. First-time deploy procedure

1. **Provision infra** (Postgres, Redis, object storage, SMTP, nginx, DNS + TLS).
2. **Create DB** — `CREATE DATABASE signacaredb ENCODING 'UTF8' LC_COLLATE 'en_AU.UTF-8' LC_CTYPE 'en_AU.UTF-8' TEMPLATE template0;`
3. **Create roles** — owner + app_user (see §2 above).
4. **Grant extensions** — `CREATE EXTENSION IF NOT EXISTS pgcrypto;` as superuser.
5. **Run migrations** — from the owner role:
   ```bash
   cd apps/api
   NODE_ENV=production npx knex migrate:latest
   ```
6. **Verify** — expect **106+** migrations applied (baseline 81 + Phase 10/11/12 + imports/reallocations/module-access backfills). Run:
   ```bash
   npm run test:integration
   ```
   Must be 19/19 green.
7. **Seed initial admin** — run the seed script with the generated password captured from stdout:
   ```bash
   NODE_ENV=production npx tsx scripts/seed-admin.ts
   ```
8. **Revoke DB grants** on audit_log as described in §2.
9. **Deploy API** — Docker image or `pm2 start apps/api/ecosystem.config.js --env production`
10. **Deploy web** — nginx hosts `apps/web/dist`; reverse-proxy `/api/v1/*` to API upstream.
11. **Smoke test** — hit `/health` and `/ready`; log in as the seeded admin; create a patient; check audit row appears.
12. **Run BUG-278 Ollama log-hygiene probe** (from a host that can read Ollama logs):
    ```bash
    OLLAMA_BASE_URL=http://localhost:11434 \
    OLLAMA_MODEL=qwen2.5:14b \
    OLLAMA_LOG_FILES=/var/log/ollama/server.log \
    npm run probe:ollama-log-hygiene -w apps/api
    ```
    Pass criterion: probe exits `0` and reports no sentinel found in logs.
    If it fails, treat as containment: disable debug logging on the Ollama service, rotate historical logs that may contain prompts, and rerun until green.
13. **Schedule backups** — cron or managed service; retention per §7.
14. **Wire observability** — Sentry, structured logs → SIEM.
15. **Pass all four CI guards**:
    ```bash
    bash .github/scripts/check-fix-registry.sh       # should return 430/430 or higher
    bash .github/scripts/check-no-telecom.sh          # AST scan for forbidden telecom imports
    bash .github/scripts/check-acs-callers.sh         # ACS imports only from patientOutreachService.ts
    bash .github/scripts/check-naming-conventions.sh  # apiClient prefix, Knex alias, parseInt radix
    ```

## 5. Rolling deploy procedure

```bash
# 1. Merge PR to main. CI must be green.
# 2. Tag release
git tag -a v1.1.0 -m "Release 1.1.0"
git push --tags

# 3. Staging deploy (blue-green)
pnpm deploy:staging

# 4. Run integration suite against staging
STAGING_DSN=postgresql://... pnpm test:integration

# 5. Run k6 baseline — must be within SLA
npm run perf:baseline

# 6. Production deploy (blue-green with 10% canary first)
pnpm deploy:prod

# 7. Post-deploy smoke
curl -f https://api.example.com/ready

# 8. BUG-278 post-deploy probe (run on host with Ollama log access)
OLLAMA_BASE_URL=http://localhost:11434 \
OLLAMA_MODEL=qwen2.5:14b \
OLLAMA_LOG_FILES=/var/log/ollama/server.log \
npm run probe:ollama-log-hygiene -w apps/api
```

## 6. Migrations (append-only policy)

- **Never edit a merged migration.** Add a new one.
- **Every migration is idempotent** — `hasTable`, `hasColumn`, `hasIndex`, `CREATE INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`.
- **`down()` is a no-op** on schema-quality, tamper-evidence, and security-hardening migrations. See the headers on the `20260412*` migrations for rationale.
- **FK and index creation on large prod tables must use `CONCURRENTLY`** — our baseline uses synchronous DDL which is fine in dev; production should wrap heavy migrations in a maintenance window or use `knex.raw('CREATE INDEX CONCURRENTLY ...')`.

## 7. Backup & retention

| Data | Retention | Mechanism |
|---|---|---|
| Postgres full dump | 30 days hot + 7 years cold | Scheduled `pg_dump` via [backupScheduler.test.ts](../../apps/api/tests/backupScheduler.test.ts) + S3 lifecycle |
| audit_log | 7 years — then DROP PARTITION | Monthly `PARTITION BY RANGE (created_at)` |
| Transcript audio | 30 days or per-clinic policy | [audioRetentionScheduler.test.ts](../../apps/api/tests/audioRetentionScheduler.test.ts) |
| Redis queues | 7 days | BullMQ defaults |
| Structured logs | 90 days SIEM + 1 year cold | SIEM policy |

## 8. Disaster recovery drill

Run the drill at least **quarterly**:

```bash
bash scripts/dr/restore-drill.sh
```

The script:
1. Creates a scratch database
2. Restores the latest `pg_dump`
3. Runs `SELECT count(*) FROM patients` + `audit_log` sanity
4. Drops the scratch database

The local runner requires `CREATEDB` privilege — in production, run via the Postgres owner role on a managed bastion host.

Expected recovery objectives:
- **RTO**: 2 hours (from pg_dump + blue-green deploy)
- **RPO**: 24 hours (nightly full dump) — reduce to 1 hour when continuous archiving (`pgbackrest` or managed WAL shipping) is configured

## 9. On-call runbook (alerts)

| Alert | First response | Escalation |
|---|---|---|
| `/ready` returns 503 | Check DB + Redis connectivity; restart PM2 worker | DBA on-call |
| 5xx > 1% over 5 min | Check Sentry; grep `requestId` in structured log | Engineering lead |
| Rate-limit 429 spike from one IP | Investigate `X-Forwarded-For`; consider IP block | Security lead |
| RLS policy violation | `SELECT` from audit_log for that `clinic_id`; pause tenant if evidence of cross-tenant attempt | Security lead + DPO |
| Audit chain break (row_hash mismatch) | Pause writes; preserve the affected partition as evidence; notify DPO | Security lead + Clinical Safety Officer |
| Refresh token reuse detected | Check audit_log for the session family; treat as credential compromise; notify affected user | Security lead |

## 10. Security approval gates

Before any production deploy, verify:

- [ ] All CI checks green on the target SHA (unit + integration + depcruise + fix-registry + naming)
- [ ] Migrations reviewed by a second engineer
- [ ] Feature flags default to OFF for new features
- [ ] Secrets rotated if this deploy changes auth, crypto, or DB user
- [ ] Rollback plan documented (what commits to revert, what DB state must stay forward-only)
- [ ] Clinical safety officer sign-off for deploys touching the hazard register

## 11. Post-deploy validation

```bash
# Health
curl -f https://api.example.com/health
curl -f https://api.example.com/ready

# Audit chain sanity
psql $PROD_DSN -c "SELECT count(*) FROM pg_inherits WHERE inhparent='public.audit_log'::regclass;"

# Grant check
psql $PROD_DSN -c "SELECT has_table_privilege('app_user', 'audit_log', 'DELETE');"  # expect f

# Schema quality
psql $PROD_DSN -f scripts/qa/schema-quality.sql
```

## 12. Decommissioning a tenant

1. Flag the tenant `is_active=false` via `/api/v1/power-settings` (super-admin).
2. Export tenant data via the exporter job.
3. Run the anonymise path (APP 11.2) for any patient exercising right-to-erasure.
4. Archive the tenant's audit partitions.
5. After retention window, DROP the audit partitions.

---

## Comparison — Deployment practice

| Dimension | Signacare target | Epic | Oracle Cerner | Best Practice |
|---|---|---|---|---|
| Append-only migrations with idempotent guards | ✅ | ✅ | ✅ | ⚠️ |
| Blue-green deploy | ✅ planned | ✅ | ✅ | ⚠️ |
| Managed Postgres + replica | ✅ required | ✅ | ✅ | ⚠️ |
| Quarterly DR drill | ✅ required | ✅ | ✅ | ✅ |
| External SIEM integration | ✅ via pino JSON | ✅ | ✅ | ⚠️ |
| 7-year audit retention | ✅ via partitioning | ✅ | ✅ | ⚠️ |
| Runtime secrets from vault | ✅ required | ✅ | ✅ | ⚠️ |
| Vendor on-call support | ❌ (self-hosted) | ✅ | ✅ | ✅ |
| Self-hostable | ✅ | ❌ | ❌ | ⚠️ (on-prem only) |

**Verdict:** The Signacare deployment model is equivalent to Epic / Cerner on every **technical** dimension (append-only migrations, managed DB, blue-green, DR drills, SIEM, vault). The trade-off is that Signacare customers **must stand these things up themselves** or engage a managed-hosting partner — there is no single-vendor support line. This is the intended trade-off of a self-hostable open architecture, and the [docs/gold-standard-reports/](.) reports exist so an operator can do it without reinventing the work.
