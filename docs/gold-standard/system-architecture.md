# 03 — System Architecture

**Last refreshed:** 2026-05-29 (refresh — supersedes 2026-04-14 baseline; adds d10 repo-hygiene cluster, env-contract catalog SSoT, forward-fix migration governance, PART 13 font-bundle pattern, design-token codegen pipeline, and the May-2026 S0 closure-wave architectural deltas).

## 1. Monorepo layout

```
Signacare/
├── apps/
│   ├── api/           Express + TypeScript, Knex + Postgres, Redis + BullMQ
│   ├── web/           React (Vite) + MUI + Emotion (PART 13 — 13-theme system)
│   ├── mobile/        Flutter clinician app (Sara) — consumes generated Dart tokens
│   ├── patient-app/   Flutter patient companion app (Viva) — consumes generated Dart tokens
│   └── emr-gateway/   Integration gateway (HL7 / FHIR bridge, Node + Mongo)
├── packages/
│   ├── shared/        Zod schemas + TS contracts shared between API + web + (via codegen) both Flutter apps
│   └── ui-components/
├── docs/              Audit reports, threat model, plans, governance, compliance, operations
├── e2e/               Playwright specs
├── .github/scripts/   CI guards (fix-registry, no-telecom, acs-callers, naming-conventions, frontend-routes)
├── scripts/
│   ├── guards/        35+ TS guards (Layer 0a discipline, repo hygiene, schema, security)
│   ├── design-tokens/ TS→Dart token codegen (closes BUG-CROSS-LANG-DESIGN-TOKEN-CODEGEN)
│   └── k6/            Load + soak performance scripts
├── installer/         macOS installer + regen-font-bundle runbook
└── deploy/            nginx, pgbouncer, Azure Bicep, production configs
```

### Cross-project boundary discipline

Raw cross-app source imports between `apps/api`, `apps/web`, `apps/emr-gateway`, `apps/mobile`, `apps/patient-app`, `packages/shared`, `packages/ui-components` are **mechanically blocked** by `guard:cross-project-boundary` (BUG-D10-GUARD-XPROJECT-BOUNDARY). Only contract imports (`@signacare/*`) cross boundaries. This is the structural protection for the eventual mobile-apps split per PART 11.

## 2. Runtime topology

```
                                   ┌──────────────────────┐
                                   │ nginx (TLS term)     │
                                   │  + Helmet / HSTS     │
                                   └─────┬────────────────┘
                                         │
                 ┌───────────────────────┼───────────────────────┐
                 │                       │                       │
        ┌────────▼────────┐      ┌───────▼────────┐     ┌────────▼────────┐
        │  apps/web       │      │  apps/api      │     │  apps/mobile    │
        │  React + Vite   │      │  Express +     │     │  Sara (Flutter) │
        │  React Query    │─────▶│  Knex + Zod    │◀────│  + SSE + FCM    │
        │  + 13 themes    │  SSE │  + BullMQ      │     │  + Dart tokens  │
        │  + font bundle  │      └─┬────┬────┬────┘     └─────────────────┘
        └─────────────────┘        │    │    │
                                   │    │    │
                         ┌─────────┘    │    └──────────┐
                         │              │               │
                ┌────────▼────┐  ┌──────▼──────┐  ┌─────▼──────┐
                │  Postgres   │  │    Redis    │  │   FCM      │
                │  16 + RLS   │  │ + BullMQ    │  │ (push)     │
                │  FORCE RLS  │  │             │  └────────────┘
                │  + pgbouncer│  │             │        ▲
                └─────────────┘  └─────────────┘        │
                                                        │
                                   ┌────────────────────┴──────────┐
                                   │  apps/patient-app (Viva)      │
                                   │  Flutter + SharedPreferences  │
                                   │  delta sync (60s) + FCM       │
                                   │  + Dart tokens                │
                                   └───────────────────────────────┘
```

### Notes

- **nginx** is the only TLS terminator. Let's Encrypt certs.
- **`apps/web`** uses React Query (TanStack Query). PART 13 13-theme system + Inter primary + local font bundle (47 woff2 files, 1.4 MB, 15 supported scripts) make the web surface offline-strict-clinic capable for Latin + small-script content.
- **`apps/api`** is an Express app with Knex on Postgres (via pgbouncer in prod). Every request goes through `authMiddleware → tenantMiddleware → rlsMiddleware → feature router`. **FORCE RLS baseline** (BUG-ARCH-FORCE-RLS-BASELINE) means the owner role cannot bypass RLS.
- **BullMQ** workers in dev share the API process; in prod they run as a dedicated worker process. The runtime allowlist per CLAUDE.md §9.2 makes stray queue names fail loudly. **Worker failure observability + DLQ retention** baseline (BUG-SA-008) enforced via `guard:worker-failure-observability`.
- **SSE** carries live notifications to `apps/web` via the existing `/api/v1/events` pipe.
- **FCM** pushes wake Sara + Viva when backgrounded; the foreground path uses the same delta-sync endpoint so FCM outages degrade to polling, not loss.
- **Flutter apps** consume Dart design tokens generated from `apps/web/src/shared/theme/palettes.ts` by `scripts/design-tokens/generate-dart-design-tokens.ts` (closes BUG-CROSS-LANG-DESIGN-TOKEN-CODEGEN).

## 3. Data-flow — notifications

```
    ┌──────────────────┐
    │ notificationSvc  │
    │ emit(input)      │
    └─┬──────┬───┬─────┘
      │      │   │
      │      │   └──► publishUserEvent()  ──► SSE  ──► apps/web NotificationBell
      │      │
      │      └──► notifications table     ──► GET /notifications (bell popover)
      │
      └──► fcmService.sendToUser()        ──► FCM  ──► apps/mobile + apps/patient-app
                                                             │
                                                             ▼
                                              onForegroundMessage / onBackgroundMessage
                                                             │
                                                             ▼
                                                    syncClient.refresh()
                                                             │
                                                             ▼
                                              GET /mobile/sync?since=cursor
                                                             │
                                                             ▼
                                              drift of notifications + appointments
                                              + documents + reminders
```

One call to `notificationService.emit` → durable row + SSE + FCM. Staff surfaces never touch SMS.

## 4. Data-flow — patient outreach

```
                          ┌───────────────────────────┐
  any caller ─────────────▶ addJob('patient-outreach')│
  (appt reminder cron,     │                          │
   clinical note, etc.)    └─────────┬─────────────────┘
                                     │
                       ┌─────────────▼──────────────┐
                       │ patientOutreachWorker      │
                       │ + withTenantContext        │ ◀── BUG-WF42 fix
                       └─────────────┬──────────────┘
                                     │
                       ┌─────────────▼──────────────┐
                       │ patientOutreachService.send│
                       └─────┬───────────┬──────────┘
                             │           │
                   Viva FCM? │           │ SMS consent + mobile?
                             ▼           ▼
                          FCM push    ACS SMS
                             │           │
                             ▼           ▼
                       patient_outreach_log
                       (channel, kind, skip_reason,
                        override_channel, override_reason,
                        override_by_staff_id)
```

The dispatcher picks:
1. FCM if the patient has at least one live `patient_fcm_tokens` row
2. ACS SMS if `sms_consent=true` AND `mobile_phone` is set
3. Audit-logged skip otherwise

Clinician override forces a channel with a mandatory ≥10-character reason captured in `override_reason`. Critical alerts (`kind='critical_alert`) escalate to both channels when available.

## 5. Data-flow — mobile delta sync

```
    Sara / Viva                                  apps/api
    ┌─────────────┐  GET /mobile/sync?since=X   ┌──────────────┐
    │ SyncClient  │ ──────────────────────────▶ │mobileSyncSvc │
    │  refresh()  │                             │              │
    └─────────────┘                             └──┬───────────┘
          │                                        │ Per module:
          │                                        │ - notifications
          │                                        │ - appointments
          │                                        │ - messages
          │                                        │ - documents (pre-signed URLs, 1h)
          │                                        │ - reminders
          │                                        │ (filtered by patient_sync_preferences
          │                                        │  for Viva patients)
          │                                        │
          │   { items + lastSyncAt + tombstones }  │
          │ ◀──────────────────────────────────────┘
          │
          ▼
    SharedPreferences JSON cache (patient-app)
    sqflite (mobile) for write queue
```

Viva patients can toggle which modules sync to their phone via the Sync Settings screen. A module toggled off triggers tombstones on the next delta, clearing the local cache — consent gate under APP 6.

## 6. Data-flow — design-token codegen (PART 13)

```
    apps/web/src/shared/theme/palettes.ts (TS SSoT)
                       │
                       │  scripts/design-tokens/generate-dart-design-tokens.ts
                       ▼
    ┌───────────────────────────────────────────┐
    │ apps/mobile/lib/core/generated_tokens.dart│
    │ apps/patient-app/lib/core/generated_..    │
    └─────────┬─────────────────┬───────────────┘
              │                 │
              ▼                 ▼
         Sara theme        Viva theme
```

Single SSoT: `THEME_PALETTES` + `SEVERITY_COLORS` + `FONT_SIZES` + `TOUCH_TARGETS` defined once in TypeScript, consumed by web ThemeProvider + emitted as Dart constants for both Flutter apps. Regression guard `guard:cross-lang-design-token-codegen` ensures the generated Dart files match the TS source on every commit. Closes BUG-CROSS-LANG-DESIGN-TOKEN-CODEGEN.

## 7. Data-flow — font loading (PART 13)

```
    apps/web/index.html
       │
       ├──► <link rel="stylesheet" href="/fonts.css">
       │       (local bundle — 47 woff2 files for Latin/Cyrillic/Greek/Vietnamese +
       │        Arabic + Indic + Hebrew + Thai; offline-strict-clinic safe)
       │
       └──► <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC...JP...KR">
               (CDN only for CJK — full woff2 sets too large to bundle naively;
                BUG-FONT-BUNDLING-CJK-SUBSET-TOOLING tracks the subset pipeline)
```

**Single SSoT:** `FONT_STACKS` + `FONT_SCRIPT_COVERAGE` + `REQUIRED_SCRIPTS` in `palettes.ts`. Guard: `guard:font-coverage` validates the union of (local bundle + CDN) covers all 15 required scripts AND the SSoT chain is in sync with served fonts. Closes BUG-GUARD-FONT-COVERAGE.

## 8. BullMQ queues

The `jobBus` ships a runtime allowlist — a stray queue name throws at enqueue time.

| Queue | Purpose |
|---|---|
| `email` | Patient + clinician emails (non-stub worker per BUG-WF42) |
| `ai` | LLM worker with failed-job telemetry (BUG-SA-008) |
| `llm` | Fine-tuning jobs |
| `flag` | Patient flag raise / resolve |
| `hl7-outbound` | HL7 ADT / ORM outgoing |
| `hl7-inbound` | HL7 ADT parsing |
| `outlook` | Outlook calendar sync |
| `session-cleanup` | Session idle expiry sweep |
| `ocr` | Pathology PDF OCR ingestion |
| `mh-expiry` | MHA legal order expiry flags |
| `notification` | In-app notification fan-out |
| `patient-outreach` | FCM + ACS SMS dispatcher (tenant-context hardened) |

## 9. Caching

| Layer | Mechanism |
|---|---|
| React Query (frontend) | Per-feature query key factories; invalidations match on save. Dashboard uses `dashboardKeys.dashAll(...)` clinic-scoped factory (BUG-SA-002 fix). |
| SSE (server → web) | `publishClinicEvent` / `publishUserEvent`; bell feed subscribes via `useEventStream.on('notification')` |
| Redis (rate limit + sessions) | express-rate-limit + `sessionIdleMiddleware` sliding window. Patient-app layered rate-limits (BUG-ARCH-PATIENTAPP-LOGIN-RATE-LIMIT). |
| BullMQ (Redis) | Background job state |
| SharedPreferences JSON (Sara + Viva) | Cold-start render from last delta; 60s foreground refresh loop |
| App documents directory (Viva) | [document_cache.dart](../../apps/patient-app/lib/core/services/document_cache.dart) — keyed on `server_updated_at`, pruned on module disable |

## 10. Authentication flow

```
1. POST /auth/login → { accessToken, refreshToken, requiresMfa }
   ↳ Session row persisted BEFORE access-token issuance (BUG-WF21-JWT-GHOST-SESSION)
   ↳ Failed-login counter atomic DB update (BUG-WF21-AUTH-COUNTER-RACE)
2. If MFA required → POST /auth/mfa → { accessToken, refreshToken }
   ↳ Attempt cap enforced (BUG-WF21-OTP-CAP-MISSING)
3. Cookies set: signacare_access (15m) + signacare_refresh (Nd)
4. Every request → authMiddleware → req.user + req.clinicId
5. Refresh rotates both + detects session-family reuse (RFC 6819)
6. Logout → revoke session + FCM token unregister (Sara/Viva)
```

Password reset flow (BUG-WF22-PWD-RESET-MISSING — fixed):

```
1. POST /auth/password-reset/request { email } → 202 (no enumeration)
   ↳ Generates token; writes to password_reset_tokens; queues email
2. Email arrives via email worker (non-stub per BUG-WF42)
3. POST /auth/password-reset/confirm { token, newPassword }
   ↳ Validates + applies; invalidates all existing sessions
```

## 11. Authorization flow

```
Route handler chain:
  authMiddleware
    → tenantMiddleware (sets req.clinicId)
    → rlsMiddleware (SELECT set_config('app.clinic_id', ?, true))
    → requireRoles([...])      ← RBAC role gate
    → requirePermission('x:read')  ← RBAC permission gate
    → requireModuleRead(MODULE_KEYS.X)  ← ABAC module gate with RBAC fallback
    → feature handler (uses AuthContext per CLAUDE.md §13)
```

Bypass order (first-match wins):
1. `BYPASS_ROLES` = {`superadmin`, `admin`} — short-circuit allow
2. `staff_module_access` row:
   - `write`/`full` → allow read+write
   - `read` → allow read, deny write
   - `none` → deny (overrides RBAC)
3. No row → look up `MODULE_TO_PERMISSION[module]` and check `req.user.permissions`
4. No mapping → fall-through allow (safe default — unmapped module = pre-retrofit behaviour)

**FORCE RLS** (BUG-ARCH-FORCE-RLS-BASELINE) means even the database owner role cannot bypass row-level security — staging/prod DBA posture proof remaining via `ALTER ROLE owner-role NOBYPASSRLS`.

## 12. Discipline layer (Layer 0a + L1-L5)

The repository ships an unusually deep CI / commit-time discipline scaffold:

```
                  ┌─────────────────────────────────┐
                  │ Layer 0a (claim-time)           │
                  │  - confidence-label-enforcer    │
                  │  - shortcut-detector            │
                  │  - gold-standard-enforcer       │
                  │  - dod-completion-checker       │
                  └────────────┬────────────────────┘
                               │
                  ┌────────────▼────────────────────┐
                  │ Pre-commit hooks (.husky)       │
                  │  - 15 fast guards (~10-15s)     │
                  │  - gitleaks scan                │
                  │  - claude-discipline:ci         │
                  │  - check-commit-claims          │
                  └────────────┬────────────────────┘
                               │
                  ┌────────────▼────────────────────┐
                  │ Commit-msg hook                 │
                  │  - check-review-attestation     │
                  │    (S0/S1/S2 bug-closure +     │
                  │     migrations + features-3plus│
                  │     require tree-hash-bound     │
                  │     review chain artifact)      │
                  └────────────┬────────────────────┘
                               │
                  ┌────────────▼────────────────────┐
                  │ CI gate (PR)                    │
                  │  - L1 tsc / lint / build        │
                  │  - L2 unit tests                │
                  │  - L3 code-reviewer-general     │
                  │  - L4 clinical-safety-reviewer  │
                  │  - L5 architecture-reviewer     │
                  │  - 35+ structural guards        │
                  │  - 2,221 fix-registry anchors   │
                  │  - integration tests            │
                  │  - playwright e2e               │
                  └─────────────────────────────────┘
```

Documented at CLAUDE.md §11. The d10 repo-hygiene cluster (BUG-D10-*) ships on top of this scaffold via the `repo-hygiene-guards` CI job.

## 13. Env-contract architecture (BUG-INFRA-ENV-CONTRACT-GAP)

Five templates × 197 runtime env keys × 197 catalog keys (no drift).

```
  Source code (process.env.X)
        │
        │  AST scan
        ▼
  guard:env-template-contract  ──────►  Validates:
        │                                  - every code-referenced env var
        │                                    is in a template
        │                                  - every template-listed key
        │                                    is referenced somewhere
        │                                  - 5 templates exist + non-empty
        │
        ▼
  ┌────────────────────────────────────────┐
  │ apps/api/.env.example                  │
  │ apps/api/.env.production.template      │
  │ apps/emr-gateway/.env.example          │
  │ apps/web/.env.example                  │
  │ .env.example (root)                    │
  └────────────────────────────────────────┘
        │
        ▼
  docs/operations/env-contract-catalog.md   (operator-facing SSoT)
```

Boot-time check loud-fails on missing required PHI / blind-index / DB / Redis keys (BUG-ARCH-PHI-KEY-MANDATORY). Closes BUG-INFRA-ENV-CONTRACT-GAP.

## 14. Migration forward-fix governance (BUG-SA-009)

Irreversible migrations (e.g., `BUG-362`) require explicit registration in `migration-forward-fix-only-register.json` with rationale. Rehearsal proof (`npm run migrate:rehearsal`) verifies forward-fix posture. Rollback-discipline guard enforces `down()` is non-empty for everything else.

```
  Author writes migration
        │
        │ Does down() throw / require manual surgery?
        ├─► YES ─► Register in migration-forward-fix-only-register.json
        │           with reason + tested forward-fix path
        │
        └─► NO  ─► Standard rollback-discipline applies:
                    - down() non-empty
                    - DROP TABLE/POLICY/CONSTRAINT use IF EXISTS
                    - dropTableIfExists not dropTable
```

## 15. Deferred / roadmap

| Topic | Status |
|---|---|
| **Telehealth video (native WebRTC)** | ⚠️ deferred — link out to Jitsi / hospital's existing provider |
| **Oncology Phase 8 (mCODE)** | ⚠️ deferred — specialty enum exists, clinical tables not yet built |
| **Native BI dashboard** | ⚠️ deferred — data SQL-queryable, UI layer deferred |
| **Kubernetes / HA deploy** | 🟡 Bicep single-instance; HA documented in deployment guide but not productionised |
| **My Health Record upload** | 🟡 documented; NASH cert integration pending |
| **CJK glyph subset pipeline** | ⚠️ open (BUG-FONT-BUNDLING-CJK-SUBSET-TOOLING) — CJK fonts currently on CDN |
| **mobile-apps repo split** | ⚠️ planned per PART 11 — `guard:cross-project-boundary` is the structural pre-requisite |

---

## Comparison — Architecture

| Dimension | Signacare | Epic | Oracle Cerner | Best Practice |
|---|---|---|---|---|
| Monorepo with shared types package | ✅ (`packages/shared/`) | ⚠️ internal | ⚠️ internal | ⚠️ |
| Row-level security + per-request tenant injection | ✅ | ⚠️ instance-per-tenant | ⚠️ instance-per-tenant | ❌ |
| **FORCE RLS baseline (owner cannot bypass)** | ✅ in code | ❌ | ❌ | ❌ |
| SSE + FCM unified notification fan-out | ✅ | ✅ | ✅ | ⚠️ |
| Mobile delta sync with tombstones + per-module opt-in | ✅ unique consent model | ✅ | ✅ | ❌ |
| BullMQ with runtime allowlist | ✅ unique | ⚠️ internal | ⚠️ internal | ❌ |
| **Worker failure observability + DLQ retention guard** | ✅ | ✅ | ✅ | ⚠️ |
| Shared binary resolver for child processes | ✅ unique | ⚠️ | ⚠️ | ❌ |
| Hardened backup pipeline (`spawn` + array args) | ✅ | ✅ | ✅ | ⚠️ |
| **Env-contract catalog SSoT + AST runtime discovery guard** | ✅ unique (197 keys, 5 templates) | ❌ | ❌ | ❌ |
| **Cross-project boundary guard (mobile-split-ready)** | ✅ unique | ❌ | ❌ | ❌ |
| **Cross-language design token codegen (TS → Dart)** | ✅ | ⚠️ vendor-internal | ⚠️ vendor-internal | ❌ |
| **Local font bundle for offline-strict clinics (15 scripts)** | ✅ unique | ⚠️ Latin-centric | ⚠️ Latin-centric | ⚠️ |
| **Layer 0a claim-discipline guards** | ✅ unique | ❌ | ❌ | ❌ |
| **Review-attestation tree-hash binding (S1+)** | ✅ unique | ❌ | ❌ | ❌ |
| **Forward-fix migration governance** | ✅ | ⚠️ | ⚠️ | ⚠️ |
| **35+ structural CI guards + 2,221 fix-registry anchors** | ✅ unique | ❌ internal | ❌ | ❌ |
| WebRTC telehealth | ⚠️ **deferred** | ✅ | ✅ | ⚠️ |
| Kubernetes HA deployment | ⚠️ **deferred** | ✅ | ✅ | ✅ |
