# Signacare EMR — Technical Architecture (v2)

> Last updated: 2026-03-28

## 1. System Overview

Signacare EMR is an enterprise-grade mental health Electronic Medical Record system for Australian public and private mental health services. It runs locally on macOS or scales to multi-server production deployment.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                        │
│   React SPA + MUI + React Query + SSE EventSource              │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS / Vite Proxy
┌───────────────────────────▼─────────────────────────────────────┐
│                     Nginx (SSL termination)                     │
│   /           → Static SPA                                      │
│   /api/       → Express API cluster                             │
│   /api/v1/events/stream → SSE real-time                         │
└────────┬──────────────┬──────────────┬──────────────────────────┘
         │              │              │
┌────────▼────┐  ┌──────▼─────┐  ┌────▼──────────┐
│ Express API │  │ AI Worker  │  │ SSE/Events    │
│ (PM2 ×4)    │  │ (BullMQ)   │  │ (Redis PubSub)│
│ Port 4000   │  │ Concur: 2  │  │               │
└──────┬──────┘  └──────┬─────┘  └───────┬───────┘
       │                │                │
┌──────▼────────────────▼────────────────▼───────┐
│                    Redis 7                      │
│  DB0: Sessions  DB1: Rate-limit  DB2: BullMQ   │
│  DB3: Cache/PubSub                              │
└───────────────────────┬────────────────────────┘
                        │
┌───────────────────────▼────────────────────────┐
│               PostgreSQL 16                     │
│  125 tables | 411 FKs | 104 RLS | 329 triggers │
│  489 indexes | 2 materialised views             │
│  PgBouncer (production)                         │
└───────────────────────┬────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
   ┌────▼─────┐   ┌─────▼──────┐  ┌────▼─────┐
   │ Ollama   │   │  Whisper   │  │ HL7      │
   │ LLM GPU  │   │  STT       │  │ Workers  │
   │ 11434    │   │  8080      │  │ (BullMQ) │
   └──────────┘   └────────────┘  └──────────┘
```

## 2. Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 18 + TypeScript + MUI 6 | SPA with 228 components |
| State | Zustand + React Query 5 | Client + server state |
| Build | Vite 8 | Dev server with API proxy |
| API | Express 4 + TypeScript | 389 REST endpoints |
| Database | PostgreSQL 16 + Knex | 125 tables, RLS, audit triggers |
| Cache | Redis 7 (4 logical DBs) | Sessions, rate-limit, jobs, pubsub |
| Job Queue | BullMQ | AI jobs, HL7, report generation |
| Real-time | Server-Sent Events (SSE) | Push notifications via Redis pubsub |
| Auth | JWT HttpOnly cookies + bcrypt | 60min access, 7d refresh, TOTP MFA |
| AI/LLM | Ollama (llama3.2, qwen2.5:14b) | 12 clinical AI actions |
| Speech | Whisper (faster-whisper) | Medical scribe transcription |
| Search | PostgreSQL tsvector + pg_trgm | Full-text + fuzzy patient search |
| Process Mgr | PM2 | Production clustering |
| Reverse Proxy | Nginx | SSL, static files, API proxy |

## 3. Frontend Architecture

### Component Count: 228 TSX files across 20+ feature modules

```
apps/web/src/
  features/
    auth/           Login, MFA, session management
    dashboard/      Role-aware dynamic dashboard (5 views)
    patients/       CRUD + 19 detail tabs
    appointments/   Scheduling, calendar
    receptionist/   Check-in, phone triage, SMS, waitlist
    handover/       Shift handover with AI summary
    case-management/ Resources page
    reports/        Admin reports + Report Builder
    staff-settings/ Staff directory, team/role management
    settings/       Clinic settings
    power-settings/ Platform config (lookup lists)
    drafts/         Draft notes + voice memo recorder
    ...
  shared/
    components/ui/  Sidebar, AppShell, GuidedTour, StaffPicker, PatientPicker
    hooks/          useEventStream (SSE), useInactivityTimer, useTabConfig
    services/       apiClient (retry, CSRF, dynamic timeout)
    store/          authStore, sessionStore, uiStore
```

### Patient Detail: 19 Tabs in 5 Groups
| Group | Tabs |
|-------|------|
| **Clinical** | Summary, Overview, Episodes, Alerts & Plans (7 sub-tabs), Medications (7 sub-tabs), Pathology, Assessments |
| **Planning** | Physical Health (+ tracking), Tracking, 91-Day Review, Pathways, Lived Experience |
| **Legal** | Legal, Referrals, Correspondence, Documents |
| **Inpatient** | Inpatient Care (8 sub-tabs), ECT (6 sub-tabs) |
| **Admin** | Appointments |

### Key Frontend Patterns
- **Lazy loading**: All pages via `React.lazy()` — code-split per route
- **SSE real-time**: `useEventStream()` hook auto-reconnects, invalidates React Query caches
- **Role-aware rendering**: Dashboard switches views; prescriber gating on medication/ECT
- **Auto-refresh**: Dashboard every 2 min with manual refresh button
- **KPI sparklines**: 7-point SVG trend lines with trend badges (% change)
- **Tab config**: `useTabConfig()` filters tabs per clinic configuration
- **Guided tours**: 6 interactive role-based walkthroughs

## 4. API Architecture

### 389 Routes across domain-scoped modules

```
apps/api/src/
  config/           config.ts (Zod-validated), redis.ts (4 logical DBs)
  db/               db.ts (Knex pools + monitoring), migrations/
  features/
    auth/           Login, logout, refresh, MFA, me
    patients/       CRUD, search (full-text + fuzzy), flags, contacts
    episodes/       CRUD, close, team allocation, ISBAR
    clinical-notes/ CRUD, signing workflow, AI generation
    medications/    CRUD, MAR, prescriptions, interactions
    appointments/   CRUD, check-in with clinician notification
    llm/            clinicalAi (12 actions), aiJobRoutes (async BullMQ)
    events/         SSE stream (real-time push via Redis pubsub)
    reports/        admin-overview, Report Builder API
    audit/          Patient timeline, record history, staff activity, AI provenance
    settings/       Tab config, clinic settings
    roles/          74 role-based endpoints (roleFeatureRoutes.ts)
    privacy/        Data export, anonymisation, consent, breach log
    ...
  jobs/workers/
    aiWorker.ts     BullMQ worker: AI jobs with validation + provenance
    hl7Worker.ts    HL7 message processing
    mhExpiryWorker  MHA order expiry monitoring
  middleware/
    authMiddleware  JWT verification from cookies
    rbacMiddleware  Role-based access control
    superadminGuard 4-eyes principle for destructive actions
    ipAllowlist     Optional IP/CIDR restriction
    errorHandler    Global error handler with Sentry
  integrations/
    fhir/           FHIR R4: 10 resources (Patient, Encounter, Observation, etc.)
    escript/        e-Prescribing (stub)
    pathology/      HL7 MLLP transport
    nhsd/           National Health Service Directory
```

### Authentication Flow
```
POST /auth/login → bcrypt verify → JWT minted → HttpOnly cookies set
  signacare_access  (60 min, SameSite=Strict in prod, Lax in dev)
  signacare_refresh (7 days)

Every request → authMiddleware reads cookie → verifies JWT → sets req.user
  → rbacMiddleware checks role against route requirements
  → RLS context set: SET LOCAL app.clinic_id = '...'

401 → frontend saves URL → redirects to /login → on success → redirects back
```

### AI Processing Architecture
```
Frontend → POST /api/v1/ai/jobs → {jobId} (202 Accepted, <50ms)
  → BullMQ queue (Redis DB2)
    → AI Worker picks up (concurrency: 2, rate: 10/min)
      → Ollama generates response
      → Validation layer checks:
         - Empty/short output
         - Hallucinated drug doses (>10x standard)
         - Cross-patient PII leak (multiple MRNs)
         - Missing required sections (5P formulation)
         - Markdown stripping
      → Provenance recorded (ai_provenance table):
         - Model name + version
         - Output SHA-256 hash
         - Input data references
         - Validation results
      → Result published to Redis pubsub
        → SSE delivers to frontend in real-time
        → React Query cache auto-invalidated

Fallback: GET /api/v1/ai/jobs/:id (polling)
```

### Rate Limiting
| Scope | Dev | Production | Store |
|-------|-----|------------|-------|
| API general | 600/min | 300/min | Redis DB1 |
| Auth login | 200/15min | 20/15min | Redis DB1 |
| LLM/AI | 100/min | 30/min | Redis DB1 |
| Dev startup | Auto-flush | No flush | — |

## 5. Database Architecture

### Scale
| Metric | Count |
|--------|-------|
| Base tables | 125 |
| Views | 30 (29 backward-compat + 1 audit timeline) |
| Foreign keys | 411 |
| RLS policies | 104 |
| Triggers | 329 (audit: 95+ tables, timestamp: 189, search: 1) |
| Indexes | 489 (incl. 103 clinic_id, 38 soft-delete, 3 trigram, 1 GIN) |
| Materialised views | 2 (mv_daily_metrics, mv_staff_caseload) |

### Multi-Tenancy
Three layers of isolation:
1. **Schema-level**: All 104 tenant-scoped tables have `clinic_id` FK
2. **RLS-level**: PostgreSQL policies enforce `clinic_id = current_setting('app.clinic_id')`
3. **Application-level**: Every query includes `WHERE clinic_id = req.clinicId`

### Search Infrastructure
- **Full-text**: `search_vector` tsvector on patients with weighted fields (A=name, B=MRN, C=Medicare, D=phone)
- **Fuzzy**: `pg_trgm` extension with trigram GIN indexes on `given_name`, `family_name`
- **API**: Uses `plainto_tsquery` + trigram similarity for typo-tolerant search

### Write Performance
- Composite indexes on `clinical_notes(patient_id, created_at DESC)`
- Partial indexes on `deleted_at IS NULL` for soft-delete filtering
- Materialised views for reporting (concurrent refresh via `refresh_report_views()`)
- Audit log archival function `archive_old_audit_logs(months)`

## 6. Security Architecture

| Layer | Implementation |
|-------|---------------|
| Authentication | JWT HttpOnly cookies, bcrypt, TOTP MFA |
| Authorization | RBAC (6 roles, 48 permissions), prescriber gating |
| Tenant Isolation | 104 RLS policies (database-enforced) |
| CSRF | X-CSRF-Token header required |
| Rate Limiting | Redis-backed per-IP (4 tiers) with memory fallback |
| IP Allowlisting | Optional via `IP_ALLOWLIST` env |
| Audit | 329 triggers → `audit_log` table |
| AI Governance | `ai_provenance` table: model, hash, validation, clinician review |
| 4-Eyes Principle | `superadminGuard` middleware for destructive actions |
| Encryption | pgcrypto for PII, TLS for transport |
| Data Protection | Soft delete, consent tracking, breach logging |
| Session Safety | 15min inactivity timeout, 75min during AI scribe |

## 7. Real-Time Architecture

```
SSE Endpoint: GET /api/v1/events/stream
  Per-user persistent connection
  Redis pubsub channels:
    ai-events:{clinicId}      — AI job progress/completion
    clinic-events:{clinicId}  — Patient arrival, escalations
    user-events:{userId}      — Task assignments, messages

Frontend: useEventStream() hook
  Auto-reconnect with exponential backoff
  Heartbeat every 30s
  Auto-invalidates React Query caches on events
  Event types: ai-job-complete, patient-arrived, task-assigned,
               medication-due, pathology-result, escalation
```

## 8. FHIR R4 Interoperability

10 FHIR R4 resources at `/api/v1/fhir/`:
| Resource | Source Table | Status |
|----------|-------------|--------|
| Patient | patients | Full |
| Condition | diagnoses | Full |
| MedicationStatement | patient_medications | Full |
| AllergyIntolerance | patient_allergies | Full |
| Encounter | episodes | Full |
| Observation | nursing_assessments + structured_observations | Full |
| DiagnosticReport | pathology_results | Full |
| Practitioner | staff | Full (incl. AHPRA, prescriber identifiers) |
| Organization | clinics | Full (incl. ABN) |
| CapabilityStatement | metadata | Full |

## 9. Deployment Models

### Single Clinic (macOS .app)
```
Signacare.app → starts PostgreSQL, Redis, Ollama, Whisper, API
  → Health checks (DB, Redis, Ollama, Whisper)
  → Rate limit flush
  → Opens browser
```

### Production (Multi-Server)
```
Nginx (SSL) → PM2 cluster (4 workers × N servers)
  → PgBouncer → PostgreSQL primary (+replica)
  → Redis Sentinel (3 nodes)
  → Ollama GPU server(s)
  → Whisper GPU server
  → BullMQ workers (AI, HL7, reports)
```

### Lite Edition
- llama3.2 only (2GB) + Whisper small.en (500MB) = ~2.5GB download
- For 8GB RAM Macs / limited bandwidth clinics
- Upgradeable to full edition by downloading larger models

## 10. Codebase Metrics

| Metric | Count |
|--------|-------|
| Lines of code | ~220,600 |
| TypeScript/TSX files | ~228 React + API |
| API routes | 389 |
| React components | 228 |
| Patient detail tabs | 19 (in 5 groups) |
| Sub-tabs within tabs | 28+ (MAR, NEWS2, ECT treatments, etc.) |
| Database tables | 125 |
| Materialised views | 2 |
| FHIR R4 resources | 10 |
| AI actions | 12 (queued via BullMQ) |
| Guided tour steps | 44 (across 6 role tours) |
