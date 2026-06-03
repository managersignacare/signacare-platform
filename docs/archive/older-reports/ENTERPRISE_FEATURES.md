# Signacare EMR — Enterprise Features (v3.3)

> Last updated: 2026-04-11
>
> **Changelog (v2 → v3):** Adds BlobStorage facade, Idempotency-Key middleware, persistent backup + restore drill, OpenTelemetry + Prometheus, JobBus facade, read/write DB split, CDN/CSP, hardened SMART-on-FHIR OAuth 2 server, async FHIR Bulk `$export`, Postgres tsvector patient search (live), generic inbound webhook receiver, pluggable secrets resolver, in-house feature flag system, standby Postgres readiness gate, scribe live transcript + 99-language Whisper + audio retention purge, clinical note revision history, pre-consult RAG context, ICD-10 suggestion persistence, per-clinician tone K-shot adaptation, evidence retrieval corpus, SSRF/taper/forbidden-access/optimistic-locking/prompt-injection safety controls, audit log partitioning + hash chain, 12-category test suite (unit → k6 → MASVS → axe-core), and CI Fix-Registry + naming-conventions guards.
>
> **Changelog (v3 → v3.1, S6.1):** Emergency break-glass access (two-phase request → two-person approval → time-limited JWT → audit-tagging middleware → Slack alert); WebAuthn/FIDO2 MFA hardened (Redis-backed challenges, counter-regression detection, credential management, migration-backed table); OWASP ZAP DAST baseline in nightly CI; axe-core Playwright specs wired into CI `a11y` job across /login, patient list, and patient detail tabs; VPAT 2.5 scaffold at `docs/accessibility/VPAT.md`.
>
> **Changelog (v3.1 → v3.2, S6.2):** WCAG 2.2 AA materially closed — MUI contrast audit script (`npm run a11y:contrast`) enforces 48 palette pairs across 8 themes with `onPrimary` field per theme; `@dnd-kit` `KeyboardSensor` wired on bed Kanban board and template OptionsList for Tab/Space/arrow keyboard drag-and-drop (SC 2.1.1); SVG pattern overlays (diagonal / crosshatch / dots / vertical) on donut chart segments so colour-blind users can distinguish series (SC 1.4.1); `autocomplete` tokens on patient registration (SC 1.3.5); axe-core coverage extended to patient detail Summary/Notes/Meds/Risk and top-level /dashboard, /handover, /reports; NVDA/VoiceOver/JAWS walkthrough procedures documented at `docs/accessibility/SCREEN_READER_WALKTHROUGHS.md`; VPAT revision 2 with six criteria moved from *Partially Supports* to *Supports*.
>
> **Changelog (v3.2 → v3.3, S7):** **Identity management** — blind-index columns (HMAC-SHA-256) on Medicare/IHI/DVA for deterministic duplicate lookup without decrypting encrypted columns; multi-signal duplicate scoring (identifier + DOB ± 1 day + fuzzy trigram name + phone + address); `POST /patients/duplicates/check` + `POST /patients/:id/merge` (admin two-person) + `GET /patients/:id/merges`; `patient_merges` table with immutable JSONB snapshot; partial unique indexes prevent duplicate Medicare/IHI/DVA at the DB layer. **Note quick-insert macros** — `GET /clinical-notes/patient/:id/snippets?types=...` returns formatted markdown for pathology/risk/outcomes/vitals/meds/allergies with provenance citations; `useSnippetMacros` React hook binds Alt+Shift+P/R/O/V/M/A shortcuts in NoteEditor and inserts the snippet at the cursor position of whichever SOAP field currently has focus; screen-reader announcement via `aria-describedby`. **Mobile medical scribe** — PWA-installable `/m/scribe/:patientId` route with consent gate, MediaRecorder + live transcript pane, reuses existing `ScribeStreamingClient` (no second scribe pipeline), manifest scoped to `/m/`, Apple touch metadata wired, minimal layout skipping desktop AppShell for 360px phones.

## 1. Security & Compliance

### Authentication & Authorization
| Feature | Implementation |
|---------|---------------|
| JWT HttpOnly Cookies | Access (60 min) + refresh (7 days), never in JavaScript |
| RBAC | 6 system roles, 48 granular permissions |
| MFA | TOTP-based with QR code setup |
| Prescriber Gating | Only staff with prescriber_number can access Prescribe buttons |
| Session Timeout | 15 min inactivity, 75 min during AI scribe, 2 min warning |
| Idle Timeout Enforcement | Server-side session idle timeout (APP 11.2) — idle sessions are invalidated server-side, not just UI-timed |
| Concurrent Session Limit | Max 5 active sessions per user, tracked in session-tree table |
| WebAuthn / FIDO2 (ML3) | Hardware-key + platform authenticator support; register/verify/login/verify/list/delete endpoints with Redis-backed challenges, per-credential signature counter, counter-regression detection for cloned authenticator defence |
| Break-Glass Access | Two-phase emergency access: credential-verified request → admin/superadmin approval (two-person rule, requester cannot self-approve) → 30-minute JWT with SHA-256 token hash stored; deny, revoke, list, active-session endpoints; audit-tagging middleware links every downstream audit row to the originating `break_glass_sessions` row |
| Break-Glass Alerting | Slack security webhook fires on request / approve / deny / revoke events (dry-run fallback logs in dev) |
| 4-Eyes Principle | Destructive superadmin actions require second superadmin approval |
| Prompt-Injection Guard | AI inputs scanned for injection payloads before reaching the LLM |

### Data Protection
| Feature | Implementation |
|---------|---------------|
| Row-Level Security | 104 policies — database-enforced tenant isolation |
| Audit Trail | 329 triggers on 95+ tables → `audit_log` |
| Audit Log Tamper Protection | INSERT-only for `app_user` + SHA-256 hash chain across rows |
| Audit Log Partitioning | Monthly partitioning for performance and lifecycle management |
| Audit Replay | Timeline reconstruction per patient, record, or staff member |
| Patient List Read Audit | List-endpoint reads (not just GET-by-id) captured in audit log |
| Forbidden Access Audit | `forbiddenAccessAudit` middleware logs all 403 attempts (HAZARD-009 / OWASP A09) |
| Soft Delete | `deleted_at` columns with partial indexes (never physically deleted) |
| PII Encryption | pgcrypto per-column for sensitive fields |
| Data Masking | `patients_masked` view strips identifiers for reporting |
| Tenant-Guarded Static Uploads | `/uploads` static route enforces clinic_id tenant check |
| Attachment `clinic_id` Backfill | Migration backfills `clinic_id` on legacy attachment rows for RLS coverage |
| APP 11.2 Erasure | Right-to-erasure workflow fixed across 8 code paths |
| Consent Tracking | Per-patient consent records for treatment, research, GP sharing |
| Breach Register | `data_breach_log` with severity, reporter, resolution |

### AI Governance
| Feature | Implementation |
|---------|---------------|
| Provenance Metadata | `ai_provenance` table records every AI output |
| Output Hashing | SHA-256 hash of generated text for integrity verification |
| Model Tracking | Model name + version persisted per output |
| Input References | Source note IDs, patient ID, data summary recorded |
| Validation Layer | Drug dose anomalies, PII leaks, markdown, missing sections |
| Prompt-Injection Guard | Input scanned for injection payloads prior to LLM dispatch |
| Prescribing Contraindication Check | Rule engine blocks/warns on known contraindications before prescription is saved |
| Taper Schedule Validation | `validateTaperSchedule` rejects unsafe step reductions (HAZARD-011) |
| Clinician Review | Accepted/modified/rejected status with modification summary |
| Prompt Versioning | Template version stored for regulatory audit |
| Draft Workflow | AI output always enters as draft — clinician must sign |
| Per-Clinician Tone Adaptation | K-shot prompting learns each clinician's note style from prior signed notes |
| Pre-Consult RAG Context | Retrieval-augmented context pack (current meds, diagnoses, active alerts, latest observations) injected at inference time |
| Evidence Retrieval Corpus | Corpus tables + client for grounding AI answers against local clinical references |
| ICD-10 Suggestion Persistence | Suggestions stored with accept/reject status for supervised-learning feedback |

### Network Security
| Feature | Implementation |
|---------|---------------|
| CSRF | X-CSRF-Token header on all mutations |
| Idempotency-Key Middleware | Clinical write endpoints accept `Idempotency-Key`; duplicate submissions are safely replayed |
| Rate Limiting | Redis DB1 per-IP (4 tiers), memory fallback if Redis down |
| IP Allowlisting | Optional via `IP_ALLOWLIST` env var |
| CORS | Strict origin validation, configurable |
| TLS | Native HTTPS or Nginx SSL termination |
| CDN Cache Headers + CSP | Per-route cache-control and Content Security Policy allow-list groundwork |
| SSRF Guard | `validateOutboundUrl` prevents internal-network egress from user-supplied URLs (44 unit tests) |
| Trust Proxy | Client IP from X-Forwarded-For behind reverse proxy |
| Inbound Webhook Receiver | Generic HMAC-signed receiver with replay protection and rate limiting |

### Compliance
| Feature | Implementation |
|---------|---------------|
| FHIR R4 | 10 resources (Patient, Encounter, Observation, Practitioner, etc.) |
| SMART on FHIR | Hardened OAuth 2 authorization server, `.well-known/smart-configuration`, scope-based access |
| FHIR Bulk `$export` | Async kickoff / poll / download pipeline producing NDJSON |
| Australian MHA | State-specific consent requirements (Vic, NSW, QLD, SA, WA) |
| Privacy | Data export, anonymisation, consent management, breach logging |
| Data Retention | Configurable policies per table |
| Audit Archival | `archive_old_audit_logs(months)` function |
| WCAG 2.1 AA | Keyboard navigation, focus management (in progress) |

## 2. Real-Time Clinical Alerts

### Server-Sent Events (SSE)
| Feature | Detail |
|---------|--------|
| Connection | Per-user persistent SSE at `/api/v1/events/stream` |
| Channels | `ai-events:{clinic}`, `clinic-events:{clinic}`, `user-events:{user}` |
| Events | patient-arrived, task-assigned, medication-due, pathology-result, escalation, ai-job-complete |
| Auto-reconnect | Exponential backoff (1s → 30s max) |
| Heartbeat | Every 30 seconds |
| Cache Invalidation | Auto-invalidates React Query caches per event type |

### Replaces Polling For
- Dashboard KPIs (was 2 min polling)
- Patient arrival notifications
- Task assignments
- Medication due alerts
- AI job completion

## 3. AI & Clinical Intelligence

### Async AI Processing (BullMQ)
| Feature | Detail |
|---------|--------|
| Queue | `ai-jobs` with Redis DB2 |
| Concurrency | 2 simultaneous jobs |
| Rate Limit | 10 jobs/minute |
| Retry | 2 attempts with exponential backoff |
| Delivery | SSE push + polling fallback |
| Response Time | <50ms for job submission (vs 30-180s synchronous) |

### Scribe & Voice Enhancements
| Feature | Detail |
|---------|--------|
| Live Partial Transcript | Streaming partial transcript pane visible to clinician during recording |
| Language Coverage | Whisper language picker expanded from 18 → 99 languages |
| Audio Retention Purge | Scheduled purge of raw scribe audio per retention policy; storage via BlobStorage facade |
| Scribe Audio Storage | Audio written to configured BlobStorage backend (local / S3 / Azure) |
| Mobile Scribe (S7.3) | PWA-installable `/m/scribe/:patientId` route with consent gate, big single-tap record button, MediaRecorder streaming to the existing `ScribeStreamingClient` (5-second batched upload to on-prem Whisper). Works on iOS Safari 14.5+ and Android Chrome. Manifest scoped to `/m/` so clinicians get a home-screen launcher that opens straight into scribing. Apple touch metadata + `black-translucent` status bar wired. Minimal layout — no desktop AppShell, optimised for 360px phones. Browser-unsupported state renders a graceful fallback card. |
| Mobile Scribe accessibility | Record button is an `IconButton` with an explicit `aria-label`; recording state transitions announced via a visually-hidden `role="status"` live region; transcript pane has `role="log"` with `aria-live="polite"` for incremental VoiceOver / TalkBack updates. |

### Clinical Note Quick-Insert Macros (S7.2)
| Feature | Detail |
|---------|--------|
| `GET /clinical-notes/patient/:id/snippets` | Returns formatted markdown snippets for pathology, risk, outcomes, vitals, medications, and allergies in one round-trip. Each snippet includes a provenance citation (`_Source: pathology [abc12345, def67890] — fetched <iso>_`) so a note built from macro inserts is still traceable to its source records. All queries RLS-scoped to `clinic_id` and `patient_id`. |
| `useSnippetMacros` React hook | Exposes an `onKeyDown` handler that intercepts `Alt+Shift+<key>` keystrokes, fetches the matching snippet via the API, and calls the supplied `onInsert` callback with the formatted text. |
| Keyboard shortcuts | **Alt+Shift+P** pathology, **Alt+Shift+R** risk, **Alt+Shift+O** outcomes, **Alt+Shift+V** vitals, **Alt+Shift+M** medications, **Alt+Shift+A** allergies, **Alt+Shift+?** show shortcut list. Alt+Shift modifier chosen deliberately to avoid collision with browser/OS shortcuts. |
| Context-aware insertion | The NoteEditor tracks which SOAP field (Subjective / Objective / Assessment / Plan) currently has focus and splices the snippet at the cursor position of that field. Cursor restored after insertion on next animation frame. |
| Screen reader description | The four SOAP textareas share an `aria-describedby` link to a visually-hidden element that enumerates every macro shortcut, so NVDA / VoiceOver announce the macros on focus. |
| Graceful failure | API errors surface as an MUI `Snackbar` with `role="alert"` severity — the note content is never corrupted by a failed snippet fetch. |

### 12 AI Clinical Actions
| Action | Purpose |
|--------|---------|
| formulation | Biopsychosocial formulation |
| isbar | Clinical handover |
| maudsley | Maudsley case summary |
| 91day | Statutory 91-day review |
| letter | GP/referral letters |
| ambient | Scribe post-processing |
| admin-report | Management report |
| report-insight | Report Builder analysis |
| handover-summary | Shift handover summary |
| medication-adherence | MAR adherence analysis |
| ect-summary | ECT course summary |
| discharge | Discharge summary |

### AI Validation Pipeline
```
LLM Output → Validation Layer
  ├── Empty/short output detection
  ├── Drug dose anomaly (>10x standard patterns)
  ├── Cross-patient PII leak (multiple MRNs)
  ├── Missing required sections (5P check)
  ├── Markdown stripping
  └── Provenance recording (ai_provenance table)
```

## 4. Clinical Modules

### Medication Administration Record (MAR)
- Auto-populates from active prescriptions
- Intelligent timing: OD→08:00, BD→08:00/20:00, TDS→08:00/14:00/22:00, nocte→22:00
- Administration recording: Given/Refused/Withheld
- Context: Supervised / Self-Administered / Inpatient / Community
- Family/patient-app context (read-only from mobile app)
- Longitudinal view: 7/14/30/90 days with daily report
- AI adherence summary
- Prescriber gating (only staff with prescriber_number)

### ECT Module (6 sub-tabs)
| Sub-tab | Features |
|---------|----------|
| Course | Create/select courses, indication, electrode placement, anaesthetic protocol |
| Treatment Log | Pre-procedure, stimulus, anaesthesia, seizure (motor+EEG), recovery, side effects |
| Prescription | Prescriber-only, inpatient/community setting, charge strategy, medication instructions |
| Consent & MHA | Voluntary/involuntary/CTO/guardian/emergency, MHA order details, tribunal, second opinion |
| Assessments | Cognitive (MMSE, MoCA), pre/post nursing, pre/post medical (MSE, rating scales) |
| Documents | Upload 11 document types (consent, MHA order, ECG, CT brain, etc.) |

### Inpatient Care (8 sub-tabs)
Observations, NEWS2, Falls Risk, Fluid Balance, Wound Care, Notes, Outcome Measures, Shift Handover

### Nursing Assessments
NEWS2 auto-scoring, Falls Risk (9-item checklist), Fluid Balance, Wound Care documentation

### Physical Health Tracking
Weight, height, BMI (auto-calculated, color-coded), blood pressure, heart rate, waist circumference, blood glucose — longitudinal table

## 5. Reporting & Analytics

### Dashboard
- Role-aware (5 views): Clinician, Nursing, Case Manager, Receptionist, Manager
- KPI cards with sparklines, trend badges, target progress bars, click-through
- Auto-refresh (2 min) with SSE push for critical events

### Report Builder
- 20 combinable metrics across 6 groups
- 7 dimensions (by clinician, team, day, week, month, episode type)
- 5 visualisations: Bar, Donut (SVG), Trend, Heatmap, Table
- Automatic trend detection (variance analysis, outlier identification)
- AI Insights (Ollama analysis of report data)
- CSV export + Print/PDF
- Scheduled reports (cron-based with email)

### Materialised Views
| View | Purpose | Refresh |
|------|---------|---------|
| `mv_daily_metrics` | Appointment stats, DNA rates by day/clinic | Nightly |
| `mv_staff_caseload` | Staff caseload with over/near/ok status | Hourly |
| `refresh_report_views()` | Concurrent refresh function | Cron |

## 6. Search Infrastructure

| Feature | Technology | Index |
|---------|-----------|-------|
| Full-text patient search | PostgreSQL tsvector (live, auto-updated via trigger) | GIN index on `search_vector` |
| Fuzzy name matching | pg_trgm extension | Trigram GIN on `given_name`, `family_name` |
| Weighted ranking | A=name, B=MRN, C=Medicare, D=phone | `plainto_tsquery` |
| Fallback search | Direct ILIKE fallback when tsvector empty | Zero-downtime migration path |

### Identity Management & Duplicate Detection (S7.1)
| Feature | Detail |
|---------|--------|
| Blind-index columns | HMAC-SHA-256 of normalised Medicare / IHI / DVA stored alongside the AES-GCM ciphertext. Enables deterministic identifier lookup without decrypting the encrypted column. Key separation enforced (`BLIND_INDEX_KEY` ≠ `PHI_ENCRYPTION_KEY`) per NIST SP 800-57 §8.2.3. |
| Partial unique indexes | One active patient per clinic per Medicare / IHI / DVA — enforced at the DB layer via partial unique indexes with `WHERE deleted_at IS NULL`. Database refuses to accept a second live patient with the same identifier even if the application layer forgets to dedupe. |
| Multi-signal scoring | `findDuplicateCandidates` scores each candidate across: deterministic identifier hits (weight 1.0 — any one conclusive), DOB exact (0.35), DOB off-by-one day (0.20), trigram given_name (≤0.20), trigram family_name (≤0.20), phone (0.15), address+postcode (0.10). Confidence buckets: definite ≥ 0.95, strong ≥ 0.80, probable ≥ 0.60. |
| Pure-JS trigram fallback | Patients in dev/staging without `pg_trgm` still get fuzzy name matching via an in-JS Jaccard-over-3-grams implementation. |
| `POST /patients/duplicates/check` | Frontend wizard can ranked-score a registration payload BEFORE submission. Input is POST (not GET) so PHI never lands in URL query logs. |
| Create-time guard | Patient create endpoint blocks on any `strong` or `definite` duplicate candidate, returning `409 DUPLICATE_PATIENT` with the candidate IDs + match reasons. `probable` matches pass through — the wizard was already given a chance to review them. |
| Admin merge | `POST /patients/:id/merge` (admin / superadmin only) soft-deletes the source patient, records an immutable JSONB snapshot in `patient_merges`, logs a `PATIENT_MERGED` audit entry, and emits a warning log. Clinical records are NOT automatically re-pointed — the surviving chart surfaces the merge and a clinician moves records with the Transfer tool. |
| Merge history | `GET /patients/:id/merges` returns every merge event touching that row (as source or destination) for forensic review. |

## 7. Operational

### Startup Sequence
1. Connect Redis (non-blocking fallback to memory)
2. Verify database (`SELECT 1`)
3. Flush dev rate limits
4. Start AI worker (BullMQ, concurrency: 2)
5. Register routes + middleware
6. Start HTTP/HTTPS server

### Health Checks
| Endpoint | Checks | Use |
|----------|--------|-----|
| `GET /health` | Uptime only | Load balancer liveness |
| `GET /ready` | PostgreSQL + Redis | Readiness probe |

### Graceful Shutdown
- 30-second drain period
- Close HTTP connections
- Destroy database pools
- Quit Redis
- PM2 kill_timeout: 35s

### Backup & Recovery
| Feature | Implementation |
|---------|---------------|
| Persistent backup configuration | Clinic-configurable schedule, destination, retention — stored in DB, not env |
| Backup history | Every backup run recorded with size, duration, status, operator |
| Restore drill | Scheduled restore drill verifies backups are actually recoverable |
| Automated backup | Daily pg_dump via backup scheduler |
| Backup verification | `deploy/backup-verify.sh` — restore to test DB, verify counts, cleanup |
| Rotation | Keep last 30 days, delete older |
| Encryption | gpg-encrypted in production |
| Standby Postgres readiness gate | Readiness probe refuses traffic until replica lag is within tolerance |
| DR runbook | Step-by-step restore procedures for corruption / failure / loss / breach |

## 8. Distribution

### macOS .app
- Signed .pkg with Developer ID Installer (Signacare PTY Ltd, 6QYU8DW6S4)
- Notarization-ready build script
- First-run setup: installs PostgreSQL, Redis, Node, Ollama, Whisper
- Health checks on every launch
- Lite edition: ~2.5GB download (vs ~15GB full)

### License System
- HMAC-signed with machine ID binding
- Editions: single-user, team, enterprise
- 14-day grace period after expiry
- CLI tool: generate, activate, check

## 9. Configuration

### Tab Capability Flags
| Feature | Detail |
|---------|--------|
| `clinic_tab_config` table | Per-clinic tab visibility |
| `GET/PUT /settings/tab-config` | API for admin to enable/disable tabs |
| `useTabConfig()` hook | Frontend filters tabs by clinic config + role |
| Use case | Disable ECT for community-only clinics, hide Legal for non-MHA services |

### Power Settings (12 lookup list types)
Branding, Professional Disciplines, Clinical Roles, Role Types, System Roles, Referral Sources, Investigation Types, Alert Types, Legal Order Types, Appointment Modes, Template Categories, Episode Types

## 10. Storage & File Handling

### BlobStorage Facade
| Feature | Detail |
|---------|--------|
| Unified upload API | Single `BlobStorage` facade used by every patient-attached upload (patient attachments, pathology, documents, physical health, alerts, ECT, legal, scribe audio) |
| Pluggable backends | Local disk, Amazon S3, and Azure Blob Storage — selected per deployment via config |
| Migration path | Legacy upload sites migrated in-place; historical files re-indexed under facade |
| Tenant-safe serving | `/uploads` static serving wrapped with clinic_id tenant guard |
| Retention purge | Scheduled purge hooks (e.g. scribe audio) driven by configurable retention windows |
| `clinic_id` backfill | Legacy attachment rows backfilled with `clinic_id` so RLS covers every row |

## 11. Observability & Reliability

### Tracing, Metrics & Logs
| Feature | Detail |
|---------|--------|
| OpenTelemetry Tracing | Distributed traces across HTTP, DB, queues; OTLP exporter configurable |
| Prometheus Metrics | Request, queue, DB pool, and custom business metrics exported on `/metrics` |
| Structured Logs | Pino JSON logs with 20+ PHI field redaction and correlation IDs |
| Sentry Error Tracking | PHI-scrubbed automatic error reporting |

### Read/Write Database Split
| Feature | Detail |
|---------|--------|
| `dbRead` helper | Dashboard and reports SELECTs routed through read-replica pool |
| Replica failover | Falls back to primary if replica is unavailable or lagging |
| Opt-in per query | Writes and transactional reads remain on primary |

### Job Bus Facade
| Feature | Detail |
|---------|--------|
| JobBus abstraction | Neutral queue facade over BullMQ today with Kafka/NATS-ready shape |
| Matview refresh scheduler | Environment-gated opt-in scheduler for materialised views |
| Async FHIR Bulk `$export` | Kickoff → poll → download workflow backed by JobBus |

### Production Compile
| Feature | Detail |
|---------|--------|
| Full compile cutover | Production runs compiled JS — no `ts-node`, no runtime TypeScript |
| TypeScript 6.0.2 | Upgraded from 5.9.3 with deprecation warnings silenced |
| Source maps | Preserved for production error debugging |

## 12. Configuration, Secrets & Feature Flags

### Pluggable Secrets Resolver
| Backend | Use Case |
|---------|---------|
| Environment | Development and simple deployments |
| JSON file | Air-gapped single-clinic installs |
| File-per-secret | Docker/Kubernetes secret mounts |
| (Pluggable) | Interface ready for AWS KMS, HashiCorp Vault, Azure Key Vault |

### In-House Feature Flag System
| Feature | Detail |
|---------|--------|
| Unleash-shaped API | Backend client + evaluator compatible with Unleash SDK shape |
| Per-clinic targeting | Flags can be scoped by clinic, role, and user |
| Frontend hook | `useFeatureFlag()` React hook with live updates |
| Gradual rollout | Percentage rollouts with deterministic user bucketing |
| Kill switches | Emergency disable for risky new behaviour |

### CI Guardrails
| Guard | Blocks |
|-------|--------|
| Fix Registry guard | Silent regression of any registered verified fix |
| Naming conventions guard | `apiClient` leading-slash bugs and other path-construction errors |
| Type-check | `tsc --noEmit` across all workspaces |
| Depcruise + knip | Architecture quality — illegal imports, dead exports |
| DB schema audit | Migration integrity, orphaned columns |

## 13. Clinical Safety Controls

### Safety Engineering
| Control | Hazard Reference |
|---------|-----------------|
| Optimistic locking on clinical notes | HAZARD-006 — lost updates between concurrent clinicians |
| `forbiddenAccessAudit` | HAZARD-009 / OWASP A09 — unauthorised access attempts silently lost |
| Audit log hash chain + partitioning | HAZARD-010 — audit tamper protection and scalable retention |
| Taper schedule validation | HAZARD-011 — unsafe taper step sizes |
| Prompt-injection guard | LLM input sanitisation before model dispatch |
| Prescribing contraindication check | Contraindication rules checked prior to prescription save |
| SSRF guard | `validateOutboundUrl` on any user-supplied URL before fetching |
| Session idle timeout | APP 11.2 — idle session invalidation server-side |
| Clinical Safety Hazard Register | Living register of clinical hazards with controls and verification |

### Clinical Note Revision History
| Feature | Detail |
|---------|--------|
| `clinical_note_versions` table | Full version history for every clinical note |
| Revision viewer | UI diff between any two historical versions |
| Optimistic locking (ETag / If-Match) | Rejects concurrent overwrites with 412 Precondition Failed |
| Immutable signed versions | Signed versions preserved even when the note is amended later |

## 14. Testing & Quality Assurance

### Dynamic Application Security Testing (DAST)
| Feature | Detail |
|---------|--------|
| OWASP ZAP Baseline | Nightly `zap-baseline.py` spider + passive scan against staging; fails on HIGH severity findings |
| Report Artefacts | HTML + JSON reports uploaded with 90-day retention; Slack alert to security channel on failure |
| Rule Overrides | Documented downgrades in `scripts/zap/rules.tsv` — every override cites the compensating control |
| Dry-Run Mode | Runs in dry-run until `STAGING_URL` is provisioned, matching the k6 and DR jobs |

### Accessibility (WCAG 2.2 AA)
| Feature | Detail |
|---------|--------|
| Static Coverage Gates | CI `a11y` job enforces ARIA / landmark / skip-nav thresholds in `apps/web/src` |
| MUI Contrast Audit | `npm run a11y:contrast` enforces WCAG AA across 48 palette-token pairs spanning 8 themes. Every theme has an explicit `onPrimary` token set to the highest-contrasting button text colour (white for dark primaries, black for light primaries like signacare `#b8621a` and dusk `#FFB300`). Fails any PR that introduces a contrast regression. |
| axe-core Playwright Specs | `@axe-core/playwright` runs against /login, patient list, four patient-detail tabs (Summary, Clinical Notes, Medications, Risk), and three top-level routes (/dashboard, /handover, /reports); zero critical + serious violations required |
| Keyboard Drag-and-Drop | `@dnd-kit/core` `KeyboardSensor` + `sortableKeyboardCoordinates` on the bed Kanban board and template OptionsList — Tab → Space → arrow → Space reordering (SC 2.1.1) |
| Chart Patterns for Colour-Blind Users | Donut chart segments overlay SVG patterns (diagonal / crosshatch / dots / vertical) on top of the fill colour so users who cannot distinguish colours can still tell series apart (SC 1.4.1). Legend swatches render the same pattern. |
| `autocomplete` Tokens | Patient registration Step 1 sets `given-name`, `family-name`, `nickname`, `bday`, `tel` per WCAG SC 1.3.5 |
| Screen Reader Procedures | Documented NVDA / VoiceOver / JAWS walkthrough scripts for the seven critical workflows at `docs/accessibility/SCREEN_READER_WALKTHROUGHS.md` — AT matrix, severity ladder, finding template, VPAT exit criteria |
| VPAT 2.5 | `docs/accessibility/VPAT.md` revision 2 — six criteria moved from *Partially Supports* to *Supports* (1.3.5, 1.4.1, 1.4.3, 1.4.11, 2.1.1, 4.1.2) |
| Report Artefacts | Playwright a11y report uploaded as CI artefact for every run |

### 12-Category Test Suite
| # | Category | Highlights |
|---|----------|-----------|
| 1 | Unit | Clozapine ANC, LAI scheduling, JWT, RBAC, date utils |
| 2 | Integration | Supertest with live PostgreSQL + Redis |
| 3 | End-to-end | Playwright Page Object Models + workflow specs |
| 4 | Clinical data integrity | Audit immutability, idempotency replay, episode state machines |
| 5 | Security | OWASP A02/A05/A07/A08, headers, static analysis |
| 6 | Performance | k6 with 5 scenarios + database query plan audit |
| 7 | Architecture quality | Depcruise illegal-import rules, knip dead-code, DB schema audit |
| 8 | Mobile | MASVS L1 static scan + patient-app API auth tests |
| 9 | Availability | Health endpoint coverage + DR restore drill |
| 10 | Compliance & audit | FHIR R4 conformance + consent + anonymisation |
| 11 | CI/CD | `ci.yml` + `deploy.yml` + `nightly.yml` pipelines |
| 12 | Gold Standard Audit | Audit report generator comparing against Epic / Cerner / Best Practice |

### Additional Quality Artefacts
- **Clinical Safety Hazard Register** — machine-readable register with verification tests per hazard
- **Accessibility (axe-core)** — automated WCAG checks in CI across key screens
- **Migration Integrity Tests** — every migration verified idempotent and reversible
- **AI Security Tests** — prompt injection, cross-patient leak, output hash verification
- **Proxy & Tenant Tests** — verify RLS cannot be bypassed via proxy headers or missing clinic context

### Signed Fix Registry
- Every verified fix is registered with a grep-checkable signature; CI blocks any PR that removes a registered signature without explicit override.

## 15. Interop Hardening

| Feature | Detail |
|---------|--------|
| SMART-on-FHIR OAuth 2 Server | Hardened authorisation code grant, scope enforcement, discovery metadata |
| FHIR Bulk Data Access | `$export` async pattern — kickoff, poll, download NDJSON |
| Generic Inbound Webhook Receiver | HMAC-SHA-256 signature verification, timestamp replay window, per-source rate limits |
| HL7 v2 MLLP | ORM / ORU messaging via dedicated `hl7Worker` |
| Outbound Webhooks | Signed delivery, retry with backoff, dead-letter capture |
