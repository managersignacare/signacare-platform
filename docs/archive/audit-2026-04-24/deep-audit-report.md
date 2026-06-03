# Deep Audit Report — Signacare EMR

**Audit date:** 2026-04-24
**Audit type:** Pre-Azure-staging cutover (step 11 of `docs/plans/azure-staging-deployment.md`)
**Methodology:** Three parallel auditor agents covering (a) 19-section technical audit, (b) 7-persona + AI-module + ops-module simulation, (c) cross-cutting integration + APP compliance + audit-trail completeness. Each agent instructed to be ruthless, tie findings to file:line, and NOT re-flag known open bugs already in `docs/quality/bugs-remaining.md`.
**Exclusion:** items already in `bugs-remaining.md` or shipped this session are not re-reported here; this file captures ONLY new findings.

---

## 1. Executive summary

**New findings this audit:** 25 discrete issues surfaced — 2 CRITICAL, 5 HIGH, 13 MEDIUM, 4 LOW, 1 STRUCTURAL.

**Go / No-go for Azure staging:** **CONDITIONAL GO.** The 2 CRITICAL findings (missing `clinic_id` filters in 5 endpoints; missing clinical-note audit_log writes) MUST be closed before first clinician sees staging. Everything else can ship post-staging with tracked BUG entries.

**Passing verifications:** two-rail access model (BUG-351/354), break-glass audit trail, clozapine + psychotropic prescriber-discipline barriers (BUG-40/292/293), cross-clinician note-signing safeguard, letter patient-relationship gate, LLM audit via `llm_interactions`, clinical-note optimistic locking.

**Structural pattern:** the codebase chose **application-layer audit** (`writeAuditLog()` in service methods) over DB triggers on critical tables. Trade-off is consistent, but only enforced by discipline + code review — a single service method that forgets to call `writeAuditLog` is a silent gap. Mitigation: CI guard that asserts every mutation route either writes an audit row OR passes through a service that does.

---

## 2. New findings — per severity

### CRITICAL

#### F-001 Missing `clinic_id` filter on 5 patient-route endpoints

**File / location:**
- `apps/api/src/features/patients/patientRoutes.ts:457` `GET /:id/attachments`
- `apps/api/src/features/patients/patientRoutes.ts:632` `GET /:id/pathology`
- `apps/api/src/features/patients/patientRoutes.ts:908` `GET /:id/legal-attachments`
- `apps/api/src/features/patients/patientRoutes.ts:926` `GET /:id/alerts`
- `apps/api/src/features/patients/patientRoutes.ts:1035` `GET /:id/alerts-summary`

**Issue:** Queries filter only by `patient_id`; no `clinic_id` predicate. CLAUDE.md §1.3 is explicit: every query modifying or reading patient/clinical data MUST include `clinic_id` in the WHERE clause. RLS is the second line of defence, not the only one.

**Root cause:** Copy-paste from an early patternwhere RLS alone was assumed sufficient; BUG-351/354 tightened the RBAC layer but the queries themselves were not re-audited.

**Gold-standard fix:** Add `clinic_id: req.clinicId` to each `.where({...})` call. Same clinicId is already on `req` via `rlsMiddleware`. Pair with a CI guard (`check-query-has-clinic-id.ts`) that scans every `.where({ patient_id: ... })` call against the tables that carry `clinic_id` and fails the merge if the predicate is absent. File as **BUG-368** S0.

**Risk:** Cross-tenant clinical-data read under any RLS-policy-disabled path (migration, debug, ops maintenance). In the worst case: a clinician in Clinic A reads an attachment belonging to Clinic B simply by guessing a patient UUID.

---

#### F-002 Clinical-note mutations do NOT write `audit_log` rows

**File / location:** `apps/api/src/features/clinical-notes/clinical_note.service.ts` (create / update / sign paths)

**Issue:** The service correctly snapshots `clinical_note_versions` for versioning, but does NOT call `writeAuditLog()` for the mandatory HIPAA §164.312(b) audit-log entry. Contrast with `patientService`, `prescriptionService`, `referralService` which DO write audit rows on every mutation.

**Root cause:** Historical — when `clinical_note_versions` was added, the author assumed it replaced the audit_log requirement. It does not — `clinical_note_versions` is a RESTORE mechanism; `audit_log` is the FORENSIC trail. Two different purposes.

**Gold-standard fix:** In `clinicalNoteService.create`, `update`, `sign`: add `await writeAuditLog({ clinicId, actorId, action: 'NOTE_CREATE' | 'NOTE_UPDATE' | 'NOTE_SIGN', tableName: 'clinical_notes', recordId: note.id, oldData, newData })` wrapped in try/catch + logger.warn so audit failure does not block the clinical write (per existing audit.ts convention). Add a CI guard asserting every mutation in features that touches a row with `clinic_id` + `deleted_at` (i.e. clinical-data tables) writes an audit_log row. File as **BUG-369** S0 clinical-safety + compliance.

**Risk:** Forensic review cannot reconstruct "who edited clinical note N, when, on what device" — a clinical-incident investigation has no audit trail.

---

### HIGH

#### F-003 Unbounded list queries on 3 patient endpoints

**File / location:** `patientRoutes.ts:457, 632, 926, 1035`.

**Issue:** No `.limit()` clause. Under adversarial or normal-growth conditions (a patient with 5 000 attachments over 10 years), the query returns all rows. `Promise.all(rows.map(async r => ... resolveAttachmentDownloadUrl(r)))` at `:632` spawns one S3 call per row — pool pressure + latency.

**Gold-standard fix:** Apply `const limit = Math.min(parseInt(req.query.limit ?? '50'), 500); query.limit(limit)` consistent with the existing pattern in `clinical-notes.routes.ts`. File as **BUG-370** S2.

---

#### F-004 Optimistic locking missing on `prescriptions`, `patient_medications`, `episodes`

**File / location:** `apps/api/src/features/prescriptions/prescriptionService.ts`, `apps/api/src/features/medications/medicationService.ts`, `apps/api/src/features/episode/episodeService.ts`.

**Issue:** Only `clinical_notes` has `lock_version` + CAS update. The other three clinical tables permit silent last-write-wins. In a prescribing context, this means two clinicians updating dose concurrently — one overwrites the other with no warning.

**Root cause:** Clinical-notes lock was added per an earlier hazard analysis (HAZARD-006). Prescriptions + medications were not re-audited for the same pattern.

**Gold-standard fix:** Add `lock_version INT NOT NULL DEFAULT 0` via migration. Repository update includes `.where('lock_version', expected)` + sets `lock_version: db.raw('lock_version + 1')`. Service layer throws `409 MEDICATION_CONFLICT` / `409 PRESCRIPTION_CONFLICT` on stale writes. Frontend shows stale-write dialog. File as **BUG-371** S1.

**Risk:** Patient-safety — two clinicians changing opioid dose concurrently; last-writer wins, first edit silently reverted.

---

#### F-005 Critical-pathology + MHA-review + prescription-repeat alerts absent

**File / location:** No matching code found. Spot-checks:
- `apps/api/src/features/pathology/` — no alert-emission on critical abnormal flag (BUG-262 ingestion writes the row + creates a flag task, but no clinician-SSE push)
- `apps/api/src/features/legal/` — no cron / scheduler emits when MHA `next_review_date` crosses threshold
- `apps/api/src/features/medications/` — no alert when `repeats_remaining` hits 0 or 1

**Issue:** Clinicians rely on manually scanning the task queue or review dashboard. Silent gaps kill patients (missed critical potassium, lapsed MHA section 14).

**Gold-standard fix:** (a) add a `BEFORE INSERT` trigger on `pathology_results` that when `abnormal_flag IN ('critical_low','critical_high')` inserts a `patient_alerts` row + calls `pg_notify` → SSE emits to the treating team. (b) scheduler cron daily at 08:00 selects `mha_orders WHERE next_review_date <= now()+interval '14 days'` and emits `patient_alerts`. (c) scheduler on `patient_medications` where `repeats_remaining <= 1`. File as **BUG-372** S1 patient-safety (three sub-items).

**Risk:** Patient safety — missed critical pathology (cardiac arrest from hyperkalaemia, sepsis recognition delay), lapsed legal authority for detained patients (§14 MHA assault risk).

---

#### F-006 Dependency CVEs — protobufjs critical

**File / location:** `package-lock.json` — `npm audit --omit=dev` reports:
- **CRITICAL:** `protobufjs` GHSA-xq3m-2v4x-88gg (arbitrary code execution)
- **MODERATE:** `dompurify`, `fast-xml-parser`, `nodemailer`, `uuid`

**Gold-standard fix:** Run `npm audit fix` in pre-deploy pipeline. For `uuid` breaking change, plan upgrade separately. Wire `npm audit --audit-level=high` into the Azure deploy pipeline so future CVEs fail CI. File as **BUG-373** S1 security.

---

#### F-007 Data-retention enforcement job absent

**File / location:** No cron / scheduled task purges soft-deleted rows after 7 years.

**Issue:** Australian Privacy Act + health-records legislation require 7-year adult / to-age-25 paediatric retention, then deletion. The app has soft-delete (`deleted_at`) but nothing deletes those rows after the retention period.

**Gold-standard fix:** Add `pg_cron` extension (or BullMQ daily scheduler) that hard-deletes rows where `deleted_at < now() - interval '7 years'` on every table with `deleted_at`. Paediatric path: compute by `patient.date_of_birth + 25 years`. Every hard-delete writes an audit row `DATA_RETENTION_PURGE`. File as **BUG-374** S1 compliance.

---

### MEDIUM

#### F-008 HealthLink / Argus secure messaging absent

**Issue:** ADHA v5.0 compliance requires a secure-messaging channel (HealthLink or Argus) for referral/discharge delivery. No code in `apps/api/src/integrations/` matches these vendors.

**Gold-standard fix:** New integration under `apps/api/src/integrations/healthlink/` with OAuth + XML builder + retry. File as **BUG-375** S2 (MVP blocker for public-sector sales).

---

#### F-009 Scribe consent revocation not audit-logged

**File / location:** `apps/api/src/features/llm/scribeRoutes.ts` (revocation path)

**Issue:** Revocation updates `scribe_consents.revoked_at` and closes the WebSocket, but does NOT write a `recordLlmInteraction` row with `feature: 'scribe_consent_revoke'`. Forensic review cannot answer "when did consent revoke fire; was any audio captured between revoke and WebSocket close?".

**Gold-standard fix:** After the UPDATE, call `await recordLlmInteraction({ feature: 'scribe_consent_revoke', consentId, ... })`. File as **BUG-376** S2.

---

#### F-010 MSE template — clinician can sign note with all domains `not_assessed`

**File / location:** `apps/api/src/features/clinical-notes/clinical_note.service.ts:sign`

**Issue:** Psychiatric note template enforces ≤10 MSE domain fields but `scribeSafetyService` lets domains remain `source: 'not_assessed'` indefinitely. A signed MSE with every domain as `not_assessed` is a de facto empty mental-state exam — clinically useless.

**Gold-standard fix:** Add `validatePsychiatricNoteCompleteness()` called before `sign()`: if `note_type='mse'` OR note template is a psychiatric one, assert ≥ 8 of 10 MSE domains are NOT `not_assessed`. Throw `MSE_INCOMPLETE` with the missing domain list. File as **BUG-377** S2 clinical-safety.

---

#### F-011 PHI encryption fails soft in production

**File / location:** `apps/api/src/shared/phiEncryption.ts:41` `isPhiEncryptionEnabled()`

**Issue:** When `PHI_ENCRYPTION_KEY` is unset, the function returns `false` and writes plaintext to ENCRYPTED columns. In dev this is acceptable; in production it is a silent PHI-at-rest compliance failure.

**Mitigation in place:** BUG-366a `REQUIRED_IN_PRODUCTION` gate throws at boot if `PHI_ENCRYPTION_KEY` is absent when `NODE_ENV=production`. So the current state is: boot fails cleanly. But if the key is SET but wrong-length or corrupted, `isPhiEncryptionEnabled()` returns false and plaintext is written.

**Gold-standard fix:** Boot-time round-trip self-test — encrypt a canary string, decrypt it, assert equality; fail-fast on mismatch. File as **BUG-378** S2 compliance. (This was the L4 residual concern on BUG-366a; now explicit.)

---

#### F-012 Chat patient-context isolation incomplete mid-session

**File / location:** `apps/api/src/features/llm/llmRoutes.ts:236` + `apps/api/src/mcp/aiEnhancer.ts`

**Issue:** `POST /clinical-ai` accepts optional `patientId`. If the clinician starts without patientId then supplies one mid-conversation, the Ollama model context is not reset — prior prompts from Patient A can contaminate Patient B reasoning at the prompt-composition level.

**Gold-standard fix:** Enforce single `patientId` per session UUID. If chat starts without `patientId`, lock it; reject mid-stream `patientId` changes with `409 CHAT_CONTEXT_LOCKED`. Alternately, each `patientId` change creates a new session UUID. File as **BUG-379** S2 privacy.

---

#### F-013 Letter AI-DRAFT marker not persisted

**File / location:** `apps/api/src/features/correspondence/correspondenceService.ts:145` defines `isAiDraft` on the DTO, but no `letters.is_ai_draft` column exists on the table.

**Issue:** Once a letter is approved/sent, there is no persistent marker that it was originally AI-generated. TGA audit trail cannot answer "which letters were AI-assisted".

**Gold-standard fix:** Add `letters.is_ai_draft BOOLEAN NOT NULL DEFAULT FALSE` via migration; `letterService.regenerateSection()` sets it `true`. Clinician sign-off does NOT clear it (the letter WAS AI-assisted even after edits). File as **BUG-380** S2 compliance.

---

#### F-014 Unit tests missing for shared utilities

**Issue:** `escapeLike`, `validateOutboundUrl`, `coerceRow`, `buildAttachmentStorageKey` have NO unit tests. These are the most dangerous attack surfaces (SSRF guard, path traversal, SQL injection via LIKE wildcard).

**Gold-standard fix:** Add dedicated test files with happy-path + null/undefined + empty + boundary + adversarial inputs (injection strings, path traversal). File as **BUG-381** S2.

---

#### F-015 SSE idle cleanup resource leak on stuck `res.end()`

**File / location:** `apps/api/src/features/events/sseRoutes.ts:96-108`

**Issue:** The module-level cleanup interval calls `res.end()` and assumes it succeeds. If the socket is half-closed, `res.end()` throws; the map entry persists forever.

**Gold-standard fix:** Wrap `res.end()` in try/catch + logger.debug + force-remove from activeConnections regardless. File as **BUG-382** S3.

---

#### F-016 N+1 pattern on alert attachments

**File / location:** `patientRoutes.ts:940-945`

**Gold-standard fix:** Replace with aggregating LEFT JOIN + GROUP BY. File as **BUG-383** S3 performance.

---

#### F-017 Over-fetching in pathology `Promise.all`

**File / location:** `patientRoutes.ts:632-650`

**Gold-standard fix:** Pair with F-003 limit; only resolve download URLs for the current page. File as **BUG-384** S3 performance.

---

#### F-018 Nurse role semantics not defined

**Issue:** Grep for `nurse` / `NURSE` in `authConstants.ts` + `permissions.ts` + clinical-service routes returns no matches. Nursing actions (vitals, MAR, medication admin) likely mapped to generic "clinician" role; no explicit nurse-vs-clinician distinction at the RBAC layer.

**Gold-standard fix:** Define `clinical_roles.nursing = true` allow-list; add `requireNursingDiscipline(auth)` + `requireNotPrescriber(auth)` helpers. Wire to medication-administration endpoints (MAR write) and vitals capture. File as **BUG-385** S2 RBAC + clinical-workflow correctness.

---

#### F-019 HPI-I WARN mode indefinite

**File / location:** `apps/api/src/shared/authGuards.ts:152-191`

**Issue:** `requireValidHpii` defaults to WARN mode when `STRICT_PRESCRIBER_HPII != 'true'`. Any prescription from a staff without a valid HPI-I proceeds with a log warning. ADHA compliance requires rejection.

**Gold-standard fix:** After 30 days post-deploy, flip `STRICT_PRESCRIBER_HPII=true` in Azure production env + run audit to surface staff without valid HPI-I first. Track as **BUG-386** S2 (pair with BUG-296 which is already tracked).

---

#### F-020 Scribe transcript/audio retention policy unclear

**File / location:** `apps/api/src/features/llm/llmRoutes.ts` + `apps/api/src/mcp/scribeStreaming.ts`

**Issue:** Consent gate exists but there is no explicit TTL or deletion schedule for transcripts / audio blobs. Australian Privacy Act requires documented retention.

**Gold-standard fix:** Add `scribe_consents.retention_days` column (default e.g. 7). Nightly job deletes transcripts/audio past retention. Document in `docs/compliance/privacy-impact-assessment.md`. File as **BUG-387** S2 compliance.

---

### LOW

#### F-021 CI guard: soft-delete filter on exempt tables

**Issue:** CLAUDE.md §1.4 lists tables WITHOUT `deleted_at`. A future code change that adds `.whereNull('deleted_at')` to one of those tables compiles cleanly but crashes at runtime (column-not-found).

**Fix:** Add `check-soft-delete-filter.ts` guard. File as **BUG-388** S3.

---

#### F-022 Offline / degraded-mode absent

**Issue:** No service-worker, no IndexedDB write buffer. Network partition = browser-side data loss.

**Fix:** Phase 1 read-only cache; Phase 2 write buffer. File as **BUG-389** S3.

---

#### F-023 SAR (Subject Access Request) export completeness unverified

**File / location:** `apps/api/src/features/privacy/privacyRoutes.ts:85-107` — calls `export_patient_data()` PL/pgSQL. Function definition not code-visible in the repo (DB-side only).

**Fix:** Code-verify the function body covers all 191 tables with patient FKs (direct + transitive). Add integration test that exports a seeded patient and counts tables covered. File as **BUG-390** S2 compliance.

---

#### F-024 `.catch(() => {})` on temp-file unlink

**File / location:** `apps/api/src/mcp/scribeStreaming.ts:283` + `apps/api/src/mcp/ambientProcessor.ts:853`

**Issue:** Silently swallows unlink errors. If file is locked or permissions denied, temp file persists indefinitely.

**Fix:** `.catch(err => logger.warn({err, file: fp}, 'temp file cleanup failed — queued for retry'))` + optional reaper job. File as **BUG-391** S3.

---

### STRUCTURAL

#### F-025 Application-layer audit model: no DB triggers on critical tables

**Observation:** Only 13 peripheral tables have `audit_trigger_fn` attached via `AFTER INSERT/UPDATE/DELETE` triggers. The critical tables — `patients`, `clinical_notes`, `prescriptions`, `patient_medications`, `pathology_results`, `staff`, `mha_orders`, `referrals` — rely entirely on the service-layer calling `writeAuditLog()`. A single service method that forgets the call, a direct SQL UPDATE by ops, or a migration data-backfill that mutates these tables produces ZERO audit trail.

**Trade-off:**
- **Pro:** Performance (triggers add ~microseconds per write), simpler schema, richer audit context (business-level `action` codes vs DB-level UPDATE/INSERT).
- **Con:** Easy to bypass; no mechanical enforcement; silent gap.

**Recommendation (not a bug per se):**
Option A — ship as-is, add CI guard that asserts every mutation route in `apps/api/src/features/` either calls `writeAuditLog` directly or passes through a service method that does.
Option B — add `audit_trigger_fn` to the 8 critical tables as belt-and-braces defence; accept the perf cost. Audit_log rows would double up where the service also writes, but cheap to dedupe in forensic review.

File as **BUG-392 (STRUCTURAL)** — engineering decision required, not a simple fix.

---

## 3. Passing verifications (already correct — no action required)

| Area | File | Verdict |
|---|---|---|
| Two-rail access model (clinical + settings) | `apps/api/src/shared/authGuards.ts:219-345` | ✓ PASS — five-check clinical rail + settings authority split correctly implemented per BUG-351/354 |
| Break-glass audit trail | `apps/api/src/middleware/breakGlassAuditMiddleware.ts:40-99` | ✓ PASS — lazy expiry + JSONB action append |
| Clozapine prescriber-discipline barrier | `apps/api/src/features/clozapine/clozapineService.ts:162-182` | ✓ PASS — service gate + DB trigger defence-in-depth |
| Psychotropic prescriber-discipline barrier | `apps/api/src/features/prescriptions/prescriptionService.ts:80-107` | ✓ PASS — SSoT SQL function + service gate |
| Cross-clinician scribe-signing safeguard | `apps/api/src/features/clinical-notes/clinical_note.service.ts:151-172` | ✓ PASS — `REVIEW_AND_ADOPT_REQUIRED` enforced |
| Letter patient-relationship gate | `apps/api/src/features/llm/letterService.ts:130-189` | ✓ PASS — gate fires before state-lock check |
| Compliance dashboard access | `apps/api/src/features/reports/complianceDashboardRoutes.ts:27-50` | ✓ PASS — module gate + RLS |
| AI audit via `llm_interactions` | `apps/api/src/shared/recordLlmInteraction.ts:185-346` | ✓ PASS — model_version, redacted inputs, encrypted prompts via BUG-282 |
| Clinical-note optimistic locking | `apps/api/src/features/clinical-notes/clinical_note.repository.ts:144-191` | ✓ PASS — CAS on `lock_version` |
| SSE isolation from RLS transaction | `apps/api/src/middleware/rlsMiddleware.ts:32` + `sseRoutes.ts` | ✓ PASS — skips `/events`; shared IORedis subscriber |
| HL7 outbound error-class discipline | `apps/api/src/jobs/workers/hl7Worker.ts:179-260` | ✓ PASS — `UnrecoverableError` vs retryable; audit + admin alert |
| No hard-coded secrets in source | `apps/api/src/config/config.ts` + Zod validation | ✓ PASS — env vars only; boot Zod check |
| No raw SQL with template interpolation | Full grep | ✓ PASS — all `db.raw` uses `?` placeholders |
| Pino PHI redaction | `apps/api/src/utils/logger.ts` + `phiFields.ts` | ✓ PASS — comprehensive redact list |
| JWT non-logging | — | ✓ PASS — no `logger` call contains `authorization` header |

---

## 4. Access Control Matrix

| Persona | View clinical notes | Prescribe | Edit MHA legal | View audit log | Break-glass | Configure settings | View all patients cross-clinic |
|---|---|---|---|---|---|---|---|
| Receptionist | CANNOT | CANNOT | CANNOT | CANNOT | CANNOT | CANNOT | CANNOT |
| Nurse | CAN (if on team) | CANNOT | CANNOT | CANNOT | CANNOT | CANNOT | CANNOT |
| GP / Clinician | CAN (if on team) | CAN (discipline gate) | CANNOT | CANNOT | CAN (approval-gated) | CANNOT | CANNOT |
| Psychiatrist | CAN (if on team) | CAN (discipline gate) | CAN (if nominated) | CANNOT | CAN (approval-gated) | CANNOT | CANNOT |
| Psychologist | CAN (if on team) | CANNOT (not in allow-list) | CANNOT | CANNOT | CAN (approval-gated) | CANNOT | CANNOT |
| Clinic Manager | CANNOT (unless on team) | CANNOT | CANNOT | CAN (REPORTS_BI module) | CANNOT | CAN (view only; write requires nomination) | CANNOT |
| Nominated Admin | CAN (nominated-admin bypass) | CAN (if prescriber) | CAN (if nominated) | CAN (audit log) | CAN (approval-gated) | CAN (settings authority for own clinic) | CANNOT |
| Medical Director | CAN (if also superadmin) | CAN (if prescriber) | CAN (if superadmin) | CAN (governance dashboard) | CAN (approval-gated) | CAN (superadmin scope) | CAN (superadmin cross-clinic) |

**Deviations:** none found — matrix aligns with BUG-351/354 design.

---

## 5. Integration Health table

| Integration | Status | Error visibility | Test endpoint | Retry | Known gaps |
|---|---|---|---|---|---|
| Pathology HL7 MLLP in + out | IMPLEMENTED | Y (AppError codes) | — | BullMQ exponential backoff | BUG-260 (SFTP), BUG-263 (STAT urgency) |
| Radiology HL7 outbound | RESERVED | — | — | — | BUG-300 (ORM^O01 builder) |
| eRx / NPDS | IMPLEMENTED | Y (escriptService AppError) | — | Worker + app retry | BUG-P5-P7, BUG-303-305, F-008 (HealthLink not eRx channel but related compliance) |
| HealthLink / Argus secure messaging | **ABSENT** | — | — | — | F-008 → BUG-375 |
| Medicare / ECLIPSE billing | **ABSENT** | — | — | — | No code; file as future work |
| IHI Service (HI Service SOAP) | IMPLEMENTED | Y (hiServiceClient) | Verify endpoint | Yes | BUG-N1/N2/N4, BUG-A5.0-7 |
| MyHR / PCEHR | **ABSENT** | — | — | — | Future work |
| FCM push | IMPLEMENTED | Y (fcmService) | — | Firebase client retry | Scope not fully traced |
| Azure Key Vault | IMPLEMENTED (BUG-366a) | Y (boot.failed structured log) | — | — | — |
| Azure PG SSL | IMPLEMENTED (BUG-366b) | Y (pool pressure monitor) | — | — | — |

---

## 6. APP 1–13 compliance table

| APP | Status | Gaps |
|---|---|---|
| 1 Open & transparent | PARTIAL | No consent at registration; scribe consent modes ✓ |
| 2 Solicited collection | PARTIAL | Over-collection possible — no minimisation rule |
| 3 Unsolicited collection | NOT VERIFIED | No workflow found |
| 4 Anonymity | PARTIAL | `anonymise_patient()` PL/pgSQL — not code-audited |
| 5 Collection notification | UNCLEAR | Policy-level, not code |
| 6 Use & disclosure | PARTIAL | Data-sharing table; enforcement unaudited |
| 7 Data quality | NOT VERIFIED | No validation rules / reconciliation jobs |
| 8 Data security | PARTIAL | RLS ✓, encryption ✓, app-layer audit ✓; gaps: DB-trigger audit, key rotation, backup encryption |
| 9 Access & correction | PARTIAL | Export endpoint stub (F-023 BUG-390); amendment workflow exists |
| 10 Data quality correction | PARTIAL | No reconciliation jobs |
| 11 Security | PARTIAL | Encryption ✓, RLS ✓, soft-delete ✓; gaps: retention enforcement (F-007 BUG-374), audit completeness (F-025) |
| 12 Recognized lawful reason | PARTIAL | RLS enforces clinic boundaries; fine-grained controls incomplete |
| 13 Overseas disclosure | PARTIAL | Infra location not enforced in code |

---

## 7. Clinical Safety Risk Register (CRITICAL + HIGH only)

Ranked by patient-safety impact:

| Rank | BUG | Description | Potential harm |
|---|---|---|---|
| 1 | F-005 → BUG-372 | Critical-pathology alerts absent | Missed hyperkalaemia, sepsis recognition delay, MHA lapse |
| 2 | F-002 → BUG-369 | Clinical-note audit_log missing | Forensic investigation of a clinical incident has no audit trail |
| 3 | F-004 → BUG-371 | No optimistic lock on prescriptions / medications | Concurrent dose edits silently clobbered |
| 4 | F-001 → BUG-368 | Missing clinic_id in 5 read endpoints | Cross-tenant PHI read under RLS-disabled path |
| 5 | F-010 → BUG-377 | MSE sign with all domains 'not_assessed' | Signed empty mental-state exam; missed risk |
| 6 | F-006 → BUG-373 | protobufjs CRITICAL CVE | Arbitrary code execution against running server |
| 7 | F-007 → BUG-374 | No retention enforcement | Long-term APP 11 violation; legal-risk on discovery |

---

## 8. AI Safety Register

| BUG | Area | Severity | Description |
|---|---|---|---|
| F-009 → BUG-376 | Scribe consent revoke | MEDIUM | Revocation not `recordLlmInteraction`-audited |
| F-012 → BUG-379 | Chat patient-context isolation | MEDIUM | Mid-session patientId change contaminates reasoning |
| F-013 → BUG-380 | Letter AI-DRAFT marker | MEDIUM | No persistent `is_ai_draft` column on `letters` |
| F-020 → BUG-387 | Transcript/audio retention TTL | MEDIUM | No automated deletion schedule |
| L4-residual from BUG-366a | PHI-key round-trip self-test absent | MEDIUM (F-011 → BUG-378) | Wrong-value key → silent decrypt failure on first PHI read |

**Not-AI-but-adjacent:** F-010 MSE enforcement (since the scribe fills the MSE template — clinician must still verify, but the system should not let an auto-filled `not_assessed` flood get signed).

---

## 9. Cross-cutting patterns (systemic)

1. **Application-layer audit coverage is discipline-enforced, not mechanical** (F-025). Every new service method must include `writeAuditLog()` calls. CI guard would mechanise.

2. **Clinic_id filtering is discipline-enforced, not mechanical** (F-001). RLS is the 2nd layer; 1st layer is the app-level WHERE clause. CI guard would mechanise.

3. **Optimistic locking is inconsistent** — `clinical_notes` has it, `prescriptions` / `patient_medications` / `episodes` don't (F-004). Either everything clinical-data gets CAS or nothing does; inconsistency is the worst state.

4. **Retention enforcement is documented but not enforced** (F-007). Policies exist in `data_retention_policies` table; no job acts on them.

5. **Notifications / alerts are mostly implemented at the transport level** (SSE, FCM) but missing the RULES layer (no trigger or scheduler emits on critical thresholds — F-005). Transport without rules is a silent gap.

6. **Three ABSENT integrations that ADHA v5.0 expects** — HealthLink/Argus (F-008), Medicare/ECLIPSE (no code), MyHR (no code). All are future work; none block today but two (HealthLink, MyHR) will block ADHA conformance submission.

---

## 10. Recommendations + commit plan

### Pre-Azure-staging cutover (BLOCKERS — must close before first clinician)

- **BUG-368** (F-001) — add `clinic_id` to 5 endpoints + CI guard `check-query-has-clinic-id`
- **BUG-369** (F-002) — add `writeAuditLog()` calls to `clinicalNoteService.{create,update,sign}` + companion CI guard

### Pre-Azure-staging (HIGH — should close but not absolute blockers)

- **BUG-370** (F-003) — `.limit()` on 5 endpoints
- **BUG-371** (F-004) — optimistic lock on prescriptions + medications + episodes
- **BUG-372** (F-005) — three-part alert rules (pathology / MHA / repeats)
- **BUG-373** (F-006) — `npm audit fix`
- **BUG-374** (F-007) — retention enforcement job

### Deferred to post-staging (MEDIUM — tracked, non-blocking)

- BUG-375 (HealthLink), 376 (scribe revoke audit), 377 (MSE completeness), 378 (PHI-key self-test), 379 (chat isolation), 380 (letter AI marker), 381 (unit tests), 382 (SSE leak), 383 (N+1), 384 (over-fetch), 385 (nurse role), 386 (HPI-I strict flip), 387 (scribe retention)

### Deferred to post-staging (LOW — tracked)

- BUG-388 (soft-delete guard), 389 (offline), 390 (SAR completeness), 391 (unlink catch)

### Structural decision required

- BUG-392 — DB-trigger audit on critical tables (option A vs option B, user decision)

---

## 11. Final go / no-go for Azure staging cutover

**Recommendation:** **CONDITIONAL GO** after the two CRITICAL items (F-001 BUG-368 + F-002 BUG-369) ship. Everything else is either tracked for post-staging or has an existing open-bug entry.

The existing pre-deployment checklist (`docs/quality/pre-deployment-checklist.md`) covers the Azure-infra + config + observability tasks; this audit adds the 2 CRITICAL code-fix gates to Phase 0 (pre-work).
