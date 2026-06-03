# Pre-Deployment Checklist — Azure Staging

> **2026-05-09 note:** For current local-first execution posture and authoritative
> red/green gate status, read
> [deployment-readiness-enterprise.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/deployment-readiness-enterprise.md)
> first. This checklist remains the staging cutover checklist; it is not the
> live gate-status source.

_Executed once, in order, the week before the first real clinician hits staging. Each check is a hard gate — deployment does NOT proceed until all checks pass or are explicitly waived with a written justification signed by the user._

Checklist format: every item has a **runbook** (link or inline command), an **expected output**, and a **sign-off** (date + initials + evidence reference once done).

## Phase 0 — pre-work (can run in parallel)

| # | Check | Runbook | Expected output | Sign-off |
|---|---|---|---|---|
| 0.1 | Deep audit completed per `docs/quality/deep-audit-scope.md` | human-driven, ~1 day | Audit report with no open S0/S1 findings | |
| 0.2 | All remaining bugs above S1 either fixed or explicitly deferred by the user | `docs/quality/bugs-remaining.md` | Zero `S0 state: open` and zero `S1 state: open` items without a documented deferral | |
| 0.3 | All 17 CI guards green on `origin/main` HEAD | CI pipeline | green ✓ | |
| 0.4 | Full integration test suite green or explicitly parked with file-level notes | `node apps/api/scripts/run-integration-tests.mjs` | 100% pass or each fail has a BUG-* row in bugs-remaining | |
| 0.5 | Schema snapshot fresh vs migrations | `npm run guard:snapshot-freshness` | PASS | |
| 0.6 | Fix-registry green | `bash .github/scripts/check-fix-registry.sh` | 920+ PASS | |
| 0.7 | ADR-0006 Azure SKU sizing written based on load-test baseline | `docs/adr/ADR-0006-azure-sku-sizing.md` | Accepted status | |

## Phase 1 — Azure infrastructure provisioning

| # | Check | Runbook | Expected output | Sign-off |
|---|---|---|---|---|
| 1.1 | Resource group created in target region | Azure portal / CLI | `rg-signacare-staging-{region}` exists | |
| 1.2 | Azure Key Vault created with RBAC auth mode | Azure portal | `signacare-staging-kv` exists; access policies OFF, RBAC ON | |
| 1.3 | Secrets seeded in Key Vault (13 keys from `SENSITIVE_KEYS`) | manual paste or scripted — see `docs/operations/runbooks/key-rotation.md` | All `kebab-lower` secret names resolve; versions bumped | |
| 1.4 | Azure PG Flexible Server created — Standard_D2s_v3 — region-paired to App Service | Azure portal | Public access OFF; VNet or Private Endpoint; PgBouncer sidecar ON (transaction mode) | |
| 1.5 | PG DB + roles created via `signacare_owner` → `app_user` split | migration + bootstrap | `signacaredb` exists; `signacare_owner` + `app_user` roles have correct grants | |
| 1.6 | Azure Cache for Redis — Basic C1 — region-paired — TLS on port 6380 | Azure portal | `signacare-staging-redis` exists; `allkeys-lru` policy set | |
| 1.7 | App Service created — Windows — Node 20 | Azure portal | Plan = Premium v3 P1V3 (per ADR-0006); Always On ON | |
| 1.8 | App Service managed identity enabled | Azure portal | System-assigned MI present with a principal ID | |
| 1.9 | MI granted `Key Vault Secrets User` on the vault | Azure portal IAM | Role assignment visible | |
| 1.10 | Application Insights linked to App Service | Azure portal | Instrumentation key in `APPLICATIONINSIGHTS_CONNECTION_STRING` | |
| 1.11 | Sentry project created + DSN in Key Vault | Sentry + vault | `sentry-dsn` secret present | |

## Phase 2 — application configuration

| # | Check | Runbook | Expected output | Sign-off |
|---|---|---|---|---|
| 2.1 | App Service Application Settings populated from `.env.production.template` | Azure portal or az CLI | Every var in template exists; all `@Microsoft.KeyVault(SecretUri=...)` references resolve | |
| 2.2 | `SECRETS_BACKEND=azure_keyvault` is set; `AZURE_KEYVAULT_URL` set to the vault URL | App settings | Values match | |
| 2.3 | `NODE_ENV=production` is set | App settings | `production` | |
| 2.4 | CORS allow-list is production-tight (no wildcard, no localhost) | `.env.production.template` CORS_ORIGIN | Matches `https://app.<your-domain>` | |
| 2.5 | WebAuthn origin + RP ID match production domain | App settings | Consistent | |
| 2.6 | NASH mTLS certs uploaded to Azure Files + mount path in env | Azure Files + App Service mount | `/home/site/secrets/nash-hi-service.p12` reachable | |
| 2.7 | ADHA NPDS certs uploaded similarly | Same | `/home/site/secrets/adha.p12` reachable | |

## Phase 3 — CI / CD

| # | Check | Runbook | Expected output | Sign-off |
|---|---|---|---|---|
| 3.1 | GitHub OIDC federation configured with an Azure AD App | Azure AD + GitHub repo settings | `federated_credentials` for `Signacare/Signacare:ref:refs/heads/main` | |
| 3.2 | GitHub Actions workflow for staging deploy wired | `.github/workflows/deploy-staging.yml` | Pipeline manually triggerable; builds dist → uploads to App Service | |
| 3.3 | Deploy pipeline runs all 17 CI guards before push | workflow step | failure = pipeline halts | |
| 3.4 | Deploy pipeline does NOT accept a secret-in-env fallback (fail-closed if OIDC fails) | workflow | confirmed | |

## Phase 4 — first deploy + smoke

| # | Check | Runbook | Expected output | Sign-off |
|---|---|---|---|---|
| 4.1 | Deploy pipeline fires, finishes successfully | GitHub Actions | green checkmark | |
| 4.2 | `GET https://api.<domain>/health` returns `{"status":"ok"}` | curl | 200 OK | |
| 4.3 | `GET /ready` returns all dependency checks green | curl | 200 OK with each check OK | |
| 4.4 | Log stream shows structured `event: 'secrets.resolved'` with expected key count | App Service log stream | JSON event visible | |
| 4.5 | No FATAL or ERROR logs during first 5 min | App Service log stream | clean | |
| 4.6 | Application Insights receives first request trace | AppInsights | Live Metrics + Logs show the request | |
| 4.7 | Sentry receives a test error (forced via `/admin/test-error` if implemented) | Sentry | Event visible | |

## Phase 5 — load-test baseline

| # | Check | Runbook | Expected output | Sign-off |
|---|---|---|---|---|
| 5.1 | Load-test tool selected + scripted (k6 or Playwright-based) | `docs/archive/audit-2026-04-24/load-test-plan.md` (new) | Repeatable script | |
| 5.2 | Baseline p50 / p95 / p99 captured for: login, patient-list, patient-detail, note-save, medication-prescribe, appointment-create | load-test run | Numbers recorded in ADR-0006 | |
| 5.3 | Connection pool + lock_timeout observed under load — no drain, no 55P03 surges | App Service metrics + DB telemetry | No red lines | |
| 5.4 | Azure PG max_connections never exceeds 70% of budget during load | PG metrics | ≤ 70% | |
| 5.5 | Redis `INFO memory` and `INFO stats` show no evictions during load | Redis metrics | `evicted_keys=0` | |

## Phase 5b — live probes deferred from Wave 6 static audit (MANDATORY before production cutover)

Wave 6 exhaustive audit (2026-04-24) could not run these against the local dev stack — each requires an external actor, vendor credentials, or a live staged environment. Promoted here rather than silently deferred.

| # | Check | Runbook | Expected output | Sign-off |
|---|---|---|---|---|
| 5b.1 | **Live load test** — k6 at realistic concurrency (100-500 concurrent clinicians) against staging — captures EXPLAIN ANALYZE plans in production-volume data | `docs/archive/audit-2026-04-24/load-test-plan.md` (new) | p50/p95/p99 recorded; N+1 / unbounded regressions surfaced or cleared | |
| 5b.2 | **External pen test** — authorised vendor, contracted, scheduled window, scoped to `api.signacare.internal` + web | Vendor contract | Pen-test report; no CRITICAL/HIGH open | |
| 5b.3 | **AI adversarial red-team** — scripted prompt-injection corpus against live Ollama; covers: cross-patient leakage, hallucination, PHI-redaction bypass, discipline-barrier circumvention via prompt, system-prompt exfil | `docs/archive/audit-2026-04-24/ai-redteam-plan.md` (new) | Red-team report; every finding catalogued and triaged | |
| 5b.4 | **Vendor-sandbox round-trip** — eRx NPDS sandbox + HI Service test endpoint + MyHR dev + ADHA CTS v3.0.1 endpoint round-trip | Per-vendor runbook | All four round-trip green; BUG-344 closed | |
| 5b.5 | **Live UI click-through — 7 personas** — QA persona runs the golden path for Receptionist / Nurse / GP / Psychiatrist / Psychologist / Clinic Manager / Medical Director on staging browser | `docs/quality/persona-acceptance-plan.md` (new) | Every persona's golden path demoed end-to-end; issues catalogued | |
| 5b.6 | **Live axe-core run** — `apps/web` dev-serve scanned by axe-playwright for SC 1.4.3 contrast, SC 2.4.1 skip-links, SC 4.1.1 DOM parsing (WCAG 2.1 AA; static Wave 6c covered SC 1.1.1, 1.3.1, 2.1.1, 2.4.3, 2.4.4, 4.1.2 already) | `docs/archive/audit-2026-04-24/findings/findings-6c-wcag.md` | axe report attached; zero serious/critical violations on patient-facing pages per BUG-450 | |

All six are gated on the staging environment being live + vendor credentials available. These are NOT audit items — they are deploy-gate items.

## Phase 6 — alert rules + observability

| # | Check | Runbook | Expected output | Sign-off |
|---|---|---|---|---|
| 6.1 | Alert rule on `kind=jwt_blacklist_fail_open` sustained >5 min | App Insights alert | rule active | |
| 6.2 | Alert rule on `kind=tier_5_9_audit_write_failed` (any occurrence) | App Insights | rule active | |
| 6.3 | Alert rule on `event=boot.failed` (any occurrence) | App Insights | rule active | |
| 6.4 | Alert rule on `kind=secrets.resolved` WHERE `skipped` includes a REQUIRED_IN_PRODUCTION key | App Insights | rule active | |
| 6.5 | Alert rule on PG pool-pressure log (`used/max > 0.9`) | App Insights | rule active | |
| 6.6 | Alert rule on request-error-rate >1% over 5 min | App Insights | rule active | |
| 6.7 | On-call rotation set up + pager routing tested | runbook | confirmed | |

## Phase 7 — backup + DR

| # | Check | Runbook | Expected output | Sign-off |
|---|---|---|---|---|
| 7.1 | Azure PG automated backups enabled, 7-day retention | Azure portal | confirmed | |
| 7.2 | Backup restore drill completed per `docs/operations/runbooks/backup-restore-drill.md` | manual | drill log in `docs/archive/audit-2026-04-24/` | |
| 7.3 | Redis persistence enabled (RDB) | Azure portal | `rdb-backup-enabled=true` | |
| 7.4 | Blob storage (if in use) geo-redundant | Azure portal | RA-GRS | |

## Phase 8 — compliance sign-offs

| # | Check | Runbook | Expected output | Sign-off |
|---|---|---|---|---|
| 8.1 | TGA classification self-assessment signed off | `docs/compliance/tga-classification.md` | Signature + date | |
| 8.2 | Privacy Impact Assessment reviewed | `docs/compliance/privacy-impact-assessment.md` | Reviewer signature | |
| 8.3 | IEC 62304 traceability matrix current | `docs/compliance/iec-62304-traceability.md` | Matrix cross-checks against current code | |
| 8.4 | Threat model reviewed vs current architecture | `docs/compliance/threat-manual.md` | Reviewer signature | |
| 8.5 | Information Security Policy acknowledged by every staff member with production access | internal process | ack list | |

## Phase 9 — demo data seed (LAST)

| # | Check | Runbook | Expected output | Sign-off |
|---|---|---|---|---|
| 9.1 | Smoke tests green post-deploy (Phase 4) | — | Prerequisite | |
| 9.2 | Demo clinic + 10 fake patients + 3 fake clinicians seeded via a scoped seed script | seed script | Rows visible in staging DB | |
| 9.3 | Demo data contains NO real PHI (verified via audit log of what's loaded) | seed script output | confirmed | |
| 9.4 | Demo clinic is flagged with `is_demo=true` so filters can exclude it | DB | flag set | |
| 9.5 | Demo-data can be reset via a single documented command | runbook | one-liner | |

## Phase 10 — go / no-go

| # | Check | Who | Output |
|---|---|---|---|
| 10.1 | Product owner reviews Phase 0-9 sign-offs | User | GO / NO-GO |
| 10.2 | Engineering reviews Phase 0-9 sign-offs | Lead engineer | GO / NO-GO |
| 10.3 | Compliance reviews Phase 8 | Compliance lead / founder | GO / NO-GO |
| 10.4 | All three GO → staging opens to first UAT user | — | Staging URL handed out |

Any one NO-GO halts the cutover until the blocking check's sign-off is recovered.

## Evidence file

Every sign-off produces a dated entry at `docs/archive/audit-2026-04-24/pre-deploy-evidence/{phase-N}.md` with:
- The runbook output (command + result)
- The human judgement (reviewer initials + timestamp)
- The artefact (screenshot, log excerpt, signed document)

This evidence bundle is the auditable record of pre-deployment readiness. Keep for the life of the staging deployment.
