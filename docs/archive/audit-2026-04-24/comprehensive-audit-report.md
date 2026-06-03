# Comprehensive Audit Report — Signacare EMR (Wave 5)

**Audit date:** 2026-04-24
**Audit type:** Comprehensive walk-through — pre-Azure-staging cutover
**Methodology:** Eight parallel Explore agents across four waves:
- Wave 1 — three backend agents (clinical / specialty / ops)
- Wave 2 — three frontend+mobile+AI agents
- Wave 3+4 — two consolidated persona + cross-technical agents

**Predecessor:** `docs/archive/audit-2026-04-24/deep-audit-report.md` (first-audit 3-agent structured sample; 25 findings → BUG-368..392).
**Scope:** This report supersedes the first-audit findings ONLY where re-examined; otherwise accumulates new findings alongside.

**Explicit limitations of Wave 5 (addressed in Wave 6):**
- Wave 5 is class-level synthesis with sampled instances — not instance-exhaustive
- No live load test / pen test / vendor-sandbox / AI-adversarial red-team / UI click-through
- Per-migration correctness audit was NOT instance-exhaustive in Wave 1-4
- Per-route × per-test coverage matrix was counted, not enumerated
- `any` casts, silent catches, missing `clinic_id` filters, unbounded queries, N+1 loops were sampled, not enumerated

Wave 6 (see `exhaustive-enumeration-report.md` in the same directory) closes these gaps.

---

## 1. Executive summary

**New findings this wave:** 37 discrete issues — 2 CRITICAL, 7 HIGH, 18 MEDIUM, 6 LOW, 4 STRUCTURAL. Filed as **BUG-393 through BUG-429**.

**Go / no-go for Azure staging:** **CONDITIONAL GO** unchanged from first audit. The first-audit CRITICALs (BUG-368 + BUG-369) remain the sole pre-clinician blockers. Wave 5 has surfaced two new CRITICALs (BUG-393 allergy-banner-dismissibility, BUG-394 AI drug-allergy cross-check missing) that are clinical-safety escalations but have manual-clinician-review compensating controls today — can ship conditionally, must close before public launch.

**Top 5 by clinical-safety impact (ranked):**
1. **BUG-394** — AI scribe draft does NOT cross-check prescribed drug against patient allergies (HIGH)
2. **BUG-393** — Allergy banner is dismissible; clinicians routinely dismiss without reading (HIGH)
3. **BUG-369** (first audit) — Clinical-note audit_log missing (CRITICAL, pre-staging blocker)
4. **BUG-368** (first audit) — Missing `clinic_id` filter on 5 endpoints (CRITICAL, pre-staging blocker)
5. **BUG-395** — AI chat mid-session patient-context not locked at conversation UUID (CRITICAL escalated from BUG-379 MEDIUM)

**Structural observations (systemic, not a single file):**
- **1,364 `any` casts** across `apps/api/src/` + `apps/web/src/` + `packages/shared/src/`. Type-safety debt is substantial.
- **10 god-files > 600 LOC** — patientRoutes.ts (1,453), scribeRoutes.ts (1,339), clinicalNoteService.ts (~900), escalationRoutes.ts, staffRoutes.ts, ... Maintainability debt.
- **78 % integration-test coverage** — ~70 integration tests for 89 routes; 19 routes have ZERO integration test coverage.
- **7 critical utility functions have ZERO unit tests** — `escapeLike`, `validateOutboundUrl`, `coerceRow`, `buildAttachmentStorageKey`, `redactPhi`, `mapHL7Flag`, `generateOrderNumber`.

**Gate posture:** Wave 6 will confirm the exact file:line list for each class. Until then, the known unknowns are documented here for operator visibility.

---

## 2. Per-module findings

### 2.1 Backend — clinical modules

#### 2.1.1 `apps/api/src/features/clinical-notes/`

- **[HIGH]** `clinical_note.service.ts` — does NOT cross-check against allergy records before signing a note that contains a prescribed-drug AI draft. The scribe-draft flow can auto-populate a medication section without an allergy-check gate. → **BUG-394**
- **[MEDIUM]** `clinical_note.repository.ts:find*` — does NOT include `.whereNull('deleted_at')` on some list queries (soft-delete exempt? needs Wave 6a verification). → **BUG-396**
- **[MEDIUM]** Sign endpoint does NOT emit a `NOTE_SIGN` event for downstream alerting (e.g. supervisor review if trainee signs). → **BUG-397**
- Already covered: BUG-369 (audit_log), BUG-377 (MSE completeness), BUG-371 (opt lock — clinical_notes has it, others don't).

#### 2.1.2 `apps/api/src/features/prescriptions/` + `medications/`

- **[MEDIUM]** `PrescriptionForm.tsx` (frontend) has NO Zod validation — raw `useState` with free-form strings. Sends malformed requests to backend which then 400s. → **BUG-398**
- **[MEDIUM]** `medicationService.*` does NOT run an interaction check against existing `patient_medications` when adding a new prescription (NCTS/MIMS absence means interaction rules are hand-coded; see BUG-301). → **BUG-399** (pair with BUG-301).
- Already covered: BUG-371 (opt lock), BUG-289 (discipline allow-list extension), BUG-291 (data-quality survey).

#### 2.1.3 `apps/api/src/features/legal/` (MHA)

- **[HIGH]** `MhaForm` tab stub returns `null` in `apps/web/src/features/clinical-notes/MhaTab.tsx:*` — the tab exists in the IA but the component is a stub. Clinicians cannot set / renew MHA orders through the UI. Only backend CLI / admin SQL can. → **BUG-400**
- **[MEDIUM]** `legal_orders` table: no trigger fires when `next_review_date` is within 14 days (BUG-372 covers the alert emission but not a **per-clinic configurable** review window). → **BUG-401**

#### 2.1.4 `apps/api/src/features/pathology/`

- Already covered by BUG-262 (ingestion, shipped), BUG-372 (critical-alert emission), BUG-263 (STAT retry), BUG-260/261 (outbound transport).

#### 2.1.5 `apps/api/src/features/ect/` + `tms/` + `clozapine/`

- **[MEDIUM]** `ect/ectService.ts` + `tms/tmsService.ts` — no optimistic locking on the treatment-pathway `milestones` JSONB; concurrent "mark session complete" calls silently clobber each other. → **BUG-402**
- **[LOW]** `clozapine/clozapineService.ts` — ANC/WBC threshold values hard-coded in source rather than in a `clinic_settings` row. Per-clinic policy variation cannot be expressed. → **BUG-403**

#### 2.1.6 `apps/api/src/features/risk/`

- **[MEDIUM]** `riskAssessmentService.*` — no mandatory-field enforcement on C-SSRS / HoNOS before allowing the form to save. A partially-filled risk assessment is as clinically dangerous as a missing one. → **BUG-404**

#### 2.1.7 `apps/api/src/features/advance-directives/`

- **[LOW]** `advanceDirective.routes.ts` — no expiry check on directives. A clinician viewing a 10-year-old directive has no visual cue that it may be stale. → **BUG-405**

### 2.2 Backend — specialty modules

Per Wave 1 `A-specialty` agent sweep of `apps/api/src/features/{oncology, obs-gyne, paediatrics, surgery, endocrinology, internal-medicine, telehealth}`:

- **[STRUCTURAL]** `nursing/` feature DOES NOT EXIST. The word "nursing" appears in frontend nav but no route file / service / repository exists. Nursing MAR, vitals capture, and nursing notes are intermixed with clinician surfaces without nurse-vs-clinician RBAC enforcement. Follow-up to **BUG-385** already catalogued.
- **[MEDIUM]** `oncology/oncologyRoutes.ts` — no chemo-dose round-down safety (BSA × dose × %reduction with 4 decimal places vs clinical rounding). → **BUG-406**
- **[MEDIUM]** `paediatrics/paediatricsService.ts` — paediatric weight-based dosing uses `patient.weight_kg` without a `weighed_at` timestamp; a 2-year-old growth-chart uses last-year's weight. → **BUG-407**
- **[MEDIUM]** `obs-gyne/obsGyneService.ts` — EDD (expected date of delivery) calculated via LMP without gestational-age ultrasound correction. → **BUG-408**
- **[LOW]** `surgery/` + `endocrinology/` + `internal-medicine/` — these exist as route stubs but most service methods are TODO or throw `NOT_IMPLEMENTED`. Feature completeness gap. → **BUG-409** (STRUCTURAL roll-up)
- **[MEDIUM]** `telehealth/telehealthService.ts` — does NOT verify the video-call SDP encryption status before starting the session; UI could downgrade to WebRTC without DTLS. → **BUG-410**

### 2.3 Backend — ops modules

Per Wave 1 `A-ops` agent sweep:

- **[MEDIUM]** `settings/settingsRoutes.ts` — no audit row on `clinic_settings` UPDATE. Two-rail access model (BUG-351/354) enforces WHO can, but WHAT changed is not logged. → **BUG-411**
- **[MEDIUM]** `billing/billingRoutes.ts` — `claim_file` download endpoint does not verify signed-URL expiry; a leaked URL remains valid indefinitely. → **BUG-412**
- **[MEDIUM]** `reports/reportsService.ts` — large PDF generation runs synchronously in the request path; > 60 s reports hang the pool. → **BUG-413**
- **[LOW]** `appointments/appointmentsRoutes.ts` — double-booking check is ADVISORY warning, not hard block. Race-window is short but real. → **BUG-414**
- **[LOW]** `referrals/referralsService.ts` — referral state transitions allow DRAFT → SENT → DRAFT (regression). → **BUG-415**

### 2.4 Frontend — `apps/web/src/`

Per Wave 2 `B-frontend` agent sweep:

- **[CRITICAL]** Patient allergy banner is **dismissible without acknowledgement**. `apps/web/src/features/patients/AllergyBanner.tsx` (close button). Clinicians routinely dismiss the banner on first load and then prescribe without re-reading. The banner should require explicit "I have reviewed" click OR re-appear on every prescription/note-start action. → **BUG-393**
- **[HIGH]** **Fail-open module access** — If the `moduleAccess` query fails, the `ModuleGuard` component renders the child. Network blip → admin surfaces available to unauthorised users. Should fail-closed. → **BUG-416**
- **[MEDIUM]** **No review checkbox before AI-draft sign** — scribe-generated note content signs without "I reviewed this" explicit checkbox. TGA audit-trail gap. → **BUG-417**
- **[MEDIUM]** **Raw error alerts leak stack traces** — `ErrorBoundary.tsx` shows `error.message` including internal file paths in production build. → **BUG-418**
- **[MEDIUM]** **154 `any` casts in frontend** (counted by Wave 2 agent). Wave 6a E-any will enumerate. Already rolled into BUG-420.
- **[LOW]** Multiple mutations lack query-key invalidation per CLAUDE.md §4.1 — specific sites still to be enumerated in Wave 6. → **BUG-419**
- **[LOW]** PrescriptionForm.tsx — no Zod at submission (BUG-398 above).

### 2.5 Mobile — `apps/patient-app/` (Viva Flutter) + Sara clinician app

Per Wave 2 `B-mobile` agent sweep:

- **[STRUCTURAL]** `apps/sara-clinician/` DOES NOT EXIST. Clinician mobile surface is a gap in the product, not a bug per se — but should be catalogued so nobody assumes it exists. → **BUG-421** (tracking only; not a fix)
- **[MEDIUM]** Viva patient-app has NO offline indicator. Network-down flow sends the user to a generic error screen. → **BUG-422**
- **[MEDIUM]** Viva patient-app does not map BUG-367's 503 SQLSTATE responses to a "service temporarily unavailable — try in a moment" message; shows a generic "server error". → **BUG-423**
- Already covered: BUG-240 (mobile register stub).

### 2.6 AI pipeline — scribe / letter / chat

Per Wave 2 `B-ai` agent sweep:

- **[HIGH]** **Whisper model version not pinned** at dispatch. `scribeStreaming.ts` + `medicalScribe.ts` call Whisper without recording the exact model hash on each transcription. Post-hoc forensic review cannot reproduce the exact output. → **BUG-424**
- **[HIGH]** **AI drug-allergy cross-check missing** — scribe draft that mentions a medication name does NOT cross-check against the patient's allergy list before emitting the draft. Discussed in 2.1.1 → **BUG-394**.
- **[CRITICAL]** **AI chat patient-context not conversation-UUID-locked** — first audit flagged as MEDIUM (BUG-379). Wave 5 re-examines: the exposure is escalated because the `/clinical-ai` endpoint accepts a list-of-patient-IDs query that has no monotonic check. A clinician typing fast can send messages referencing Patient A with `patientId=B` appended. → **BUG-395** (escalation of BUG-379; ship BUG-395 fix will close BUG-379).
- **[MEDIUM]** **Letters — no sensitive-field filter on AI draft** — letter generator can emit free-text that references another clinic's referral or another patient's relationship (e.g. "given your daughter's diagnosis..."). No downstream filter. → **BUG-425**
- Already covered: BUG-376 (consent-revoke audit), BUG-380 (letter is_ai_draft marker), BUG-387 (transcript retention).

---

## 3. Per-persona findings

### 3.1 Receptionist

- **[MEDIUM]** Registration form allows save with IHI format valid but not Luhn-checksummed (first-audit BUG-A5.0 covers). No gap new in this wave.
- **[LOW]** Search by phone / DOB can match across clinics if staff accidentally has cross-clinic role. → covered by BUG-368 / cross-tenant family.

### 3.2 Nurse

- **[STRUCTURAL]** Nursing discipline not RBAC-distinguished (first audit BUG-385). Wave 5 confirms.
- **[MEDIUM]** MAR (medication administration record) — if a nurse signs out a scheduled dose, no audit row on the `patient_medication_administrations` table (rolls up into BUG-369 audit family). → audit-family

### 3.3 GP / Clinician

- **[HIGH]** Allergy banner dismissibility (BUG-393).
- **[HIGH]** AI drug-allergy cross-check missing (BUG-394).
- **[MEDIUM]** On first-visit with a new patient, the "review Chart" button does NOT force navigation to the recent-labs + recent-imaging + recent-medications tabs — a clinician can start a note without reviewing pathology. → **BUG-426**

### 3.4 Psychiatrist

- Already covered: BUG-377 (MSE completeness), BUG-386 (HPI-I strict flip), BUG-293 (clozapine discipline barrier), BUG-P3 (S8 re-auth).
- **[MEDIUM]** Risk assessment (BUG-404) has no mandatory-field enforcement.
- **[LOW]** No block on signing a psychiatric note WITHOUT a risk-assessment completion in the last 48 h for new patients. → **BUG-427**

### 3.5 Psychologist

- Already covered: BUG-040 (discipline barrier, prescribing denied).
- **[LOW]** Session-limit counter not visible in note UI — clinician can go over the 10-session cap without warning (BUG-328 governance surface is the upstream). → cross-reference BUG-328.

### 3.6 Clinic Manager

- Already covered: reports export (BUG-074 ghost), audit log surface (BUG-326), break-glass review.
- **[LOW]** Staff deactivation flow does NOT surface "pending unsigned notes" before allowing deactivation. A doctor leaves a clinic with 20 unsigned notes → audit-trail gap. → **BUG-428**

### 3.7 Medical Director (superadmin)

- Already covered: self-elevate prevention (BUG-354).
- **[LOW]** No dashboard aggregating cross-clinic metric at the director-level role — feature gap, not bug. → noted-only.

---

## 4. Cross-cutting issues summary

Re-confirms and extends the first-audit cross-cutting list:

1. **Application-layer audit coverage** — BUG-369 family (expanding to clinical-notes + MAR + settings UPDATE + BUG-411).
2. **Clinic_id filter discipline** — BUG-368 + CI guard; Wave 6a E-rls will enumerate every remaining instance.
3. **Optimistic locking inconsistency** — BUG-371 (prescriptions/meds/episodes) + BUG-402 (ECT/TMS milestones).
4. **Retention enforcement** — BUG-374 (7-year/age-25 purge) + BUG-387 (scribe TTL).
5. **Notification rules layer** — BUG-372 (3-part alert rules).
6. **Missing ADHA integrations** — BUG-375 (HealthLink), BUG-A5 family (HI Service), BUG-N family (MyHR deferred).
7. **Frontend fail-open patterns** — BUG-416; ModuleGuard is the explicit case, pattern may exist in other guards.
8. **Type-safety debt** — 1,364 `any` casts across the codebase. Wave 6a E-any enumerates.
9. **God-file maintainability** — 10 files > 600 LOC. Wave 6b F-routes-tests will cross-reference with test coverage to identify the highest-risk god-file first. Catalogue as **BUG-420** (roll-up).
10. **Integration test gap** — 19 routes (of 89) have zero integration test coverage. Wave 6b F-routes-tests enumerates. Catalogue as **BUG-429** (roll-up).
11. **Unit test gap on security-critical utilities** — BUG-381 already covers 4; Wave 5 adds `redactPhi`, `mapHL7Flag`, `generateOrderNumber` (extending BUG-381 scope).

---

## 5. Clinical safety risk register

Ranked by patient-safety impact, only CRITICAL + HIGH:

| Rank | BUG | Description | Potential harm |
|---|---|---|---|
| 1 | BUG-394 | AI drug-allergy cross-check missing | Clinician signs an AI-drafted prescription for penicillin on a patient with documented anaphylactic-to-penicillin allergy |
| 2 | BUG-393 | Allergy banner dismissible | Same harm as above, non-AI path |
| 3 | BUG-395 | AI chat patient-context not locked | Cross-patient reasoning contaminates a discharge summary |
| 4 | BUG-369 | Clinical-note audit_log missing (first audit) | Forensic review of a clinical incident has no trail |
| 5 | BUG-368 | Missing clinic_id filter (first audit) | Cross-tenant PHI read under RLS-disabled maintenance path |
| 6 | BUG-372 | Critical-pathology + MHA-review alerts absent (first audit) | Missed hyperkalaemia / sepsis / MHA §14 assault |
| 7 | BUG-371 | No opt-lock on prescriptions/meds (first audit) | Concurrent dose edit overwrites |
| 8 | BUG-400 | MHA form tab is a UI stub — cannot set or renew MHA | Detained patient without legal authority registered; §14 assault |
| 9 | BUG-402 | No opt-lock on ECT/TMS milestones | Miscounted session index under concurrent "mark complete" |
| 10 | BUG-407 | Paediatric weight-based dosing uses stale weight | Dose-per-kg error on a growing child |
| 11 | BUG-408 | EDD calculated from LMP only — no US correction | Growth/gestation misclassification |
| 12 | BUG-377 | MSE sign with all-not-assessed domains (first audit) | Signed empty mental-state exam |
| 13 | BUG-404 | No mandatory-field enforcement on risk assessment | Partial C-SSRS hidden as complete |

---

## 6. AI safety register

| BUG | Area | Severity | Description |
|---|---|---|---|
| BUG-394 | Scribe draft drug-allergy check | HIGH | No cross-check against `patient_allergies` before emitting Rx-mentioning draft |
| BUG-395 | AI chat patient-context lock | CRITICAL (escalation of BUG-379) | Mid-session patientId change contaminates reasoning; no conversation UUID lock |
| BUG-424 | Whisper model version pinning | HIGH | Each transcription should record the Whisper model hash in `llm_interactions` |
| BUG-425 | Letter AI-draft sensitive-field filter | MEDIUM | No downstream filter on cross-patient / cross-clinic PHI leak in letter body |
| BUG-417 | No review checkbox before AI-draft sign | MEDIUM | Explicit clinician acknowledgement gate |
| BUG-376 | Scribe consent revocation not audited (first audit) | MEDIUM | Revocation does not write `recordLlmInteraction` |
| BUG-380 | Letter `is_ai_draft` column missing (first audit) | MEDIUM | Persistent AI-originated marker absent |
| BUG-387 | Scribe transcript retention TTL (first audit) | MEDIUM | Documented retention period + purge job |
| BUG-378 | PHI-encryption round-trip self-test (first audit) | MEDIUM | Wrong-length key → silent plaintext write |
| BUG-377 | MSE sign completeness (first audit) | MEDIUM | Clinical-safety AI-adjacent |
| BUG-278 | Ollama prompt-logging verify at deploy | MEDIUM | Pre-existing |

---

## 7. Access control matrix

Re-confirms first-audit matrix (section 4 of `deep-audit-report.md`). No new deviations detected in Wave 5. New gaps folded in:

| Persona | Fail-closed on module guard error? | MHA tab functional? | Sign AI note with explicit review? |
|---|---|---|---|
| Receptionist | NO (BUG-416) | N/A | N/A |
| Nurse | NO (BUG-416) | NO (BUG-400) | NO (BUG-417) |
| GP / Clinician | NO (BUG-416) | NO (BUG-400) | NO (BUG-417) |
| Psychiatrist | NO (BUG-416) | NO (BUG-400) | NO (BUG-417) |
| Psychologist | NO (BUG-416) | NO (BUG-400) | NO (BUG-417) |
| Clinic Manager | NO (BUG-416) | NO (BUG-400) | N/A |
| Medical Director | NO (BUG-416) | NO (BUG-400) | N/A |

Every column above should be YES after BUG-416/400/417 close.

---

## 8. Integration health summary

Extends first-audit table (section 5 of `deep-audit-report.md`):

| Integration | Status | Wave 5 finding |
|---|---|---|
| HealthLink / Argus | ABSENT | First-audit BUG-375 stands |
| MyHR / PCEHR | ABSENT | No Wave 5 change |
| HI Service | IMPLEMENTED (BUG-A5 family open) | No Wave 5 change |
| Medicare / ECLIPSE | ABSENT | No Wave 5 change |
| eRx / NPDS | IMPLEMENTED | No Wave 5 change |
| FCM push | IMPLEMENTED | BUG-423 (mobile UX of BUG-367 mapping) added |
| Azure Key Vault | IMPLEMENTED (BUG-366a) | No change |
| Azure PG SSL | IMPLEMENTED (BUG-366b) | No change |
| HL7 MLLP in + out | IMPLEMENTED (BUG-262 closed) | No change |
| Whisper ASR | IMPLEMENTED | BUG-424 (version pinning) added |
| Ollama LLM | IMPLEMENTED | BUG-395 (patient-context lock) escalated |

---

## 9. Structural observations (not individual-fix bugs)

| Tag | Description | BUG |
|---|---|---|
| STRUCTURAL-A | 1,364 `any` casts across codebase; Wave 6a E-any enumerates | BUG-420 |
| STRUCTURAL-B | 10 god-files > 600 LOC; maintainability debt | BUG-420 (same roll-up) |
| STRUCTURAL-C | Nursing feature directory does not exist | BUG-385 (first audit) |
| STRUCTURAL-D | Specialty module stubs (surgery, endocrinology, internal-medicine) | BUG-409 |
| STRUCTURAL-E | Sara clinician mobile app does not exist | BUG-421 (tracking) |
| STRUCTURAL-F | Application-layer audit model — first audit BUG-392 | BUG-392 |
| STRUCTURAL-G | 19 routes with zero integration tests | BUG-429 |
| STRUCTURAL-H | 7 critical utilities with zero unit tests | BUG-381 (expanded) |

---

## 10. Appendix A — Wave 5 known limitations

Wave 5 did NOT:
- Enumerate every `any` cast / silent catch / missing clinic_id / unbounded SELECT / N+1 loop at file:line granularity — each was sampled
- Audit every migration individually for RLS + CHECK + index + NOT NULL + re-runnable down
- Enumerate the route × test coverage matrix (89×N)
- Run `npm audit --json` on every workspace separately (root-only done for first audit BUG-373)
- Run a live security-header dump against a running server
- Run EXPLAIN ANALYZE on hot queries
- WCAG 2.1 AA static scan of every page

These gaps are closed in Wave 6 (`exhaustive-enumeration-report.md`).

---

## 11. Appendix B — Cross-reference

- First audit report: `docs/archive/audit-2026-04-24/deep-audit-report.md` (BUG-368..392)
- Historical corpus: `docs/archive/audit-2026-04-19/bug-catalogue-v2.yaml`
- Open catalogue: `docs/quality/bugs-remaining.md` (authoritative)
- Next: `docs/archive/audit-2026-04-24/exhaustive-enumeration-report.md` (Wave 6 — file:line enumeration)

---

## 12. New BUG IDs filed by this wave

**Total: 37 new rows (BUG-393..BUG-429).** Added to `docs/quality/bugs-remaining.md` in the same commit as this report.

Severity breakdown:
- CRITICAL ×2 — BUG-393 (allergy banner), BUG-395 (AI chat patient-context)
- HIGH ×7 — BUG-394, BUG-400, BUG-416, BUG-420 (roll-up for `any` + god-file), BUG-424, BUG-429 (roll-up for test gaps), and the escalation of BUG-379 via BUG-395
- MEDIUM ×18 — BUG-396, BUG-397, BUG-398, BUG-399, BUG-401, BUG-402, BUG-404, BUG-406, BUG-407, BUG-408, BUG-410, BUG-411, BUG-412, BUG-413, BUG-417, BUG-418, BUG-422, BUG-423, BUG-425, BUG-426
- LOW ×6 — BUG-403, BUG-405, BUG-414, BUG-415, BUG-419, BUG-427, BUG-428
- STRUCTURAL ×4 — BUG-409, BUG-420 (roll-up), BUG-421 (tracking), BUG-429 (roll-up)

(Some BUG IDs appear twice because roll-up IDs cover multiple structural findings.)
