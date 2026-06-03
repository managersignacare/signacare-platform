# Signacare EMR — Comprehensive System Audit Findings

**Date:** 2026-04-19
**Scope:** Full system — API, web, mobile (Sara + Viva), docs, DB schema, integrations, AI modules, RBAC
**Baseline:** post-commit 908c13e (Phase R follow-up complete, Amendment E deferred)
**Methodology:** 11 parallel audit agents (A–K), each with a narrow read-only focus; findings consolidated here

Per-agent outputs: `docs/audit-2026-04-19/agent-{A..K}.md` + raw outputs in `/tmp/signacare-audit/`

---

## TOP-LINE VERDICT

- **Regression-free.** All 11 Phase R follow-up bugs + 672 fix-registry anchors verified clean at HEAD (Agent F).
- **Orphan-table free.** 273 tables, 0 orphans (Agent F).
- **3 production blockers** identified, all CRITICAL:
  1. `/reports/admin-overview` missing `requireRoles` guard (manager sees per-clinician audit → governance leak).
  2. `GET /medications/mar/:patientId` missing `requirePatientRelationship` (nurse reads any patient's MAR).
  3. Clinical formulations readable by psychologist via broad `CLINICAL_ROLES` (psychiatric confidentiality leak).
- **Bug 2 root-caused** by Agent J: Viva activation error-handling collapses every failure to a generic "Activation failed" message; fix is a one-file, ~20-line change.
- **AI safety** has 3 CRITICAL gaps: no audio/scribe consent; no sensitive-data gating in letter generator; no model-version locking.
- **Integration gaps**: radiology + HealthLink not implemented (major workflow impact but pre-existing scope).

---

## 1 — CLINICAL SAFETY RISK REGISTER (CRITICAL + HIGH, patient-safety ranked)

| # | Severity | Risk | Module | Root cause | Gold-standard fix |
|---|---|---|---|---|---|
| 1 | CRITICAL | Manager can access /reports/admin-overview incl per-clinician activity | Reports | reportsRoutes.ts:70 no requireRoles | Add `requireRoles(['admin','superadmin'])` |
| 2 | CRITICAL | Nurse reads any patient's MAR without care relationship | Medications | nurseFeatureRoutes.ts:54-100 no requirePatientRelationship | Add `requirePatientRelationship(auth, patientId)` before query |
| 3 | CRITICAL | Psychologist can read psychiatrist 5P formulations | Clinical notes | CLINICAL_ROLES includes psychologist; formulation routes broad | Restrict to `['psychiatrist','admin','superadmin']` + add `shared_with_clinicians` flag |
| 4 | CRITICAL | Receptionist CRUD on clinical `triage_notes` | Receptionist | phone_triage modeled as admin, not clinical | Split into `receptionist_summary` (admin) + `clinical_risk_flags` (nurse-gated) |
| 5 | CRITICAL | Scribe audio/transcript used without consent capture | AI Scribe | StreamingSession has no consentId | Mandatory consent form linked to session + audit trail |
| ~~6~~ | ~~CRITICAL~~ | ~~AI Letter includes HIV/substance/MH without consent~~ | ~~Letters~~ | **REVERSED 2026-04-19** — user direction: do NOT restrict or exclude. Clinician decides what to retain before signing. | **REVERSED — no fix** |
| 7 | CRITICAL | Model version not locked — silent Ollama upgrade changes clinical output | All AI | No checkpoint hash stored | Store checkpoint hash + require approval before upgrade |
| 8 | HIGH | Viva patient vitals silently lost if offline (5 sites empty try/catch) | Viva | No offline write queue; empty catch blocks | Persistent offline queue + flush-on-reconnect |
| 9 | HIGH | Scribe "recording active" indicator missing | AI Scribe | No UI affordance implemented | Persistent red indicator + audio cue |
| 10 | HIGH | AI Chat answers prescribing questions (scope creep) | AI Chat | No input classifier | Classifier rejects dosing/prescribing queries |
| 11 | HIGH | AI data residency not enforced (WHISPER_API_URL defaults to localhost:8080) | AI | No env validation blocks external URLs | Startup validation forbids non-AU endpoints |
| 12 | HIGH | No AI feature kill switch | All AI | No global feature flag | `clinic_feature_flags` table gates all AI routes |
| 13 | HIGH | risk/escalations/tasks services bypass AuthContext | Services | Raw `(clinicId, staffId)` params | Migrate to `AuthContext` + `requirePermission` + `requirePatientRelationship` (2-3 days) |
| 14 | HIGH | Missing mutation invalidations on clozapine MedicationsTab | Web UI | createRegMut/adminMut lack onSuccess invalidate | Add `invalidateQueries({ queryKey: clozapineKeys.registrations(patientId) })` |
| 15 | HIGH | Psychologist cannot record outcome measures | Psychology | No psychologistFeatureRoutes.ts | Create psychologist-gated outcome endpoints |
| 16 | HIGH | Secret env fallbacks silently disable 5 integrations | Integrations | `process.env.X ?? ''` fallback pattern | Fail-fast: `throw new Error('Missing env X')` |

---

## 2 — AI SAFETY REGISTER (hallucination / leakage / audit-gap ranked)

| # | Severity | Risk type | Finding | Fix |
|---|---|---|---|---|
| 1 | CRITICAL | Consent gap | Scribe + Letters — no consent for audio/transcript | Mandatory consent flow; link to encounter; audit trail |
| ~~2~~ | ~~CRITICAL~~ | ~~Data leakage~~ | ~~Letters expose HIV/substance/MH without consent~~ | **REVERSED 2026-04-19** — clinician-decides model (no programmatic exclusion) |
| 3 | CRITICAL | Audit gap | No model version / checkpoint hash stored | Store hash per generated doc; approval gate for upgrades |
| 4 | HIGH | Access gap | Cross-clinician signing without "reviewed and adopted" flag | `reviewed_and_adopted_by_id` column + UI confirmation |
| 5 | HIGH | Operational gap | No emergency kill switch for AI | Feature flag table gates every AI route |
| 6 | HIGH | Residency gap | WHISPER_API_URL can point outside AU | Env validation blocks external URLs |
| 7 | HIGH | Scope gap | AI Chat can answer prescribing questions | Input classifier rejects dosing/prescribing |
| 8 | MEDIUM | Labelling gap | `is_ai_draft` DB-only; no visible banner | Add "[AI-DRAFT — Pending review]" banner |
| 9 | MEDIUM | Governance gap | Letter templates hardcoded; no versioning | `letter_templates` table + version history |
| 10 | MEDIUM | Labelling gap | AI Chat responses missing "[⚠ Verify]" disclaimer | Append disclaimer to every response |
| 11 | MEDIUM | Audit gap | Training export RBAC weak | Restrict to ADMIN; log every export |

**Verified correct (commit 908c13e):** trainingPipeline.ts rewritten against real schema, zero `@query-col-exempt`, llm_interactions + ai_training_feedback JOIN pattern works end-to-end.

---

## 3 — ACCESS CONTROL MATRIX

7 personas × 16 modules. ✓ = CAN, ✗ = CANNOT, 🔴 = CRITICAL over-permission leak, 🟠 = HIGH under-permission.

| Persona | PtDemo | Appts | ClinicalNotes | Meds | Vitals | Path | Risk | MHA | Psych | Letters | Billing | Reports | StaffMgmt | Audit | Settings | AI |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Receptionist | ✓CRU | ✓CRU | ✗ | ✗ | ✗ | ✗ | 🔴triage-notes | ✗ | ✗ | ✗ | ✓CRU | ✗ | ✗ | ✗ | ✗ | ✗ |
| Nurse | ✓R | ✓R | ✓RW | 🔴MARnoPt | ✓RW | ✗ | ✓RW | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Clinician | ✓R | ✓RW | ✓RW | ✓RW | ✓R | ✓RW | ✓RW | ✗ | ✗ | ✓RW | ✗ | ✗ | ✗ | ✗ | ✗ | ✓RW |
| Psychiatrist | ✓R | ✓RW | ✓RW | ✓RW | ✓R | ✓RW | ✓RW | ✓RW | ✗ | ✓RW | ✗ | ✗ | ✗ | ✗ | ✗ | ✓RW |
| Psychologist | ✓R | ✓R | ✓RW | ✗ | ✓R | ✗ | ✓RW | ✗ | 🟠missingRoutes | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| ClinicManager | ✓R | 🟠blocked | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | 🔴admin-overview | ✓RW | ✓R | ✓RW | ✗ |
| MedicalDirector | ✓R | ✓R | ✓R | ✓R | ✓R | ✓R | ✓R | ✓R | ✓R | ✓R | ✓R | ✓R | ✓RW | ✓RW | ✓RW | ✓R |

**Break-glass:** FULLY IMPLEMENTED ✓ (two-person rule, TTL JWT, immutable actions_performed JSONB, Slack alert). Minor: mirror actions to central `audit_log` + add email/SMS fallback to Slack.

---

## 4 — INTEGRATION HEALTH SUMMARY

**Inventory (14 total):** 13 LIVE + 1 STUB + 0 ORPHANS.

LIVE: Pathology(HL7/MLLP), Pharmacy/eRx(triple-pathway), IHI Service, SMS/ACS(+mock), SafeScript(VicPDMP, mandatory S8), FCM push, FHIR R4(+SMART Auth+bulk export), Outlook O365, NHSD Provider Directory, CMI(Vic MH funding), Scribe prompt-guard(14 OWASP LLM01 patterns), MySL(Active Script List), Evidence(keyword — pgvector scaffolded).

**Missing integrations per user audit spec:**
- 🟠 **Radiology (orders/results)** — NOT IMPLEMENTED. Zero RIS integration. Imaging workflows entirely manual.
- 🟠 **HealthLink / Argus (secure messaging)** — NOT IMPLEMENTED. Referrals + discharges require manual print/email.
- 🟡 **Medicare / ECLIPSE billing** — MBS seed data present, no real claims submission.
- 🟡 **PCEHR / MHR push** — FHIR subscription wired, MHR document push not confirmed.

**Operational gaps:**
- No `/api/v1/health/integrations` endpoint. Ops cannot diagnose without reading logs.
- Prescription pathway exhaustion (all 3 fail) → offline mode logged but NOT escalated to admin.
- Pathology orders sent direct TCP (no BullMQ queue); network blip = order loss.

---

## 5 — CROSS-CUTTING STRUCTURAL ISSUES

These patterns appear across multiple modules and signal design-level fixes:

| # | Pattern | Module sprawl | Structural fix |
|---|---|---|---|
| S1 | Service functions accepting raw `(clinicId, staffId)` without AuthContext | risk, escalations, tasks, pathology, appointments (5+) | Migration plan: adopt AuthContext + requirePermission on next touch; existing CLAUDE.md §13 rule |
| S2 | Mental-health confidentiality not enforced at DB level | clinical_notes, clinical_formulations, patient_legal_orders, outcomes | Add `sensitivity_level` / `confidentiality_level` / `is_sensitive` columns + role-gated reads |
| S3 | AI modules missing consent + labelling + kill-switch | Scribe, Letters, Chat | Consent table + `clinic_feature_flags` table + "[AI-DRAFT]" banner + model-version locking |
| S4 | Offline write handling absent or weak in Viva | Vitals, activation, tracking | Persistent offline queue (Drift Queue pattern) + conflict-resolution UI + flush-on-reconnect |
| S5 | Silent env fallbacks disable critical integrations | tokenDelivery, npds, erxAdapter, hiService, nhsd (5 files) | Fail-fast on missing env — no empty-string defaults |
| S6 | Generic error handling swallows specific backend errors | Viva activation + 8 mobile sites + 1 backend | `on DioException catch (e) { use e.response?.data?.message }` pattern + tests |
| S7 | Literal query-key spreads bypass factory pattern | 19 sites across 8+ web features | Extend queryKeys.ts factory + pre-commit guard on `queryKey: [` outside queryKeys.ts |

---

## 6 — REGRESSION REGISTER (all clean)

All verified at HEAD by Agent F:

| Bug | Check | Result |
|---|---|---|
| B1 Dart URLs | `/mobile/sync` + `/mobile/fcm/register-device` leading-slash | ✓ |
| B3 varchar widen | gender=100, phoneMobile=100, Zod .max(100), UI maxLength=100 | ✓ |
| B4 view | patient_active_specialties exists | ✓ |
| B5 assessment_datetime | assessed_at used (ghost gone) | ✓ |
| B6 nursing review | next_review_at column present | ✓ |
| B11 audit_log ghost COALESCE | 0 ghost refs | ✓ |
| B12 OrgSettings lazy | 6 React.lazy calls | ✓ |
| D.1 guard | scripts/guards/check-query-builder-columns.ts exists | ✓ |
| Sweep: patient_team_assignments.clinic_id | 0 refs in where clauses | ✓ |
| Sweep: .whereNull('deleted_at') on exception tables | 0 violations (229 legitimate refs) | ✓ |
| trainingPipeline llm_interactions JOIN | present, 0 @query-col-exempt | ✓ |

---

## 7 — ORPHAN TABLES LIST

**None.** 273 tables audited, every one has at least one INSERT/SELECT/UPDATE/DELETE code reference.

---

## 8 — DOCUMENTATION HYGIENE

**Overall: ~95% current.** 33 docs files, 25 CURRENT, 3 RUNBOOK-ONCE, 5 historical/archived. No problematic duplication. fix-registry.md: 670 rows, 9 retired properly, all patterns testable.

**Priority actions:**
1. Create top-level `README.md` (missing).
2. Move `docs/phase-0.5-rename-runbook.md` → `docs/archive/`.
3. Update `DEPLOYMENT_GUIDE.md` stale PM2 paths (`~/signacare/app/` → current project root).
4. Update CLAUDE.md table lists to include Phase R tables (notifications, patient_outreach_log).
5. Refresh `docs/gold-standard-reports/03-system-architecture.md` (2026-04-11 snapshot; Phase 10/11/12 missing).

---

## 9 — PER-PERSONA FINDINGS SUMMARY

**Receptionist:** 🔴 CRUD on clinical `triage_notes` (B2) — blocker.

**Nurse:** 🔴 MAR read without patient-relationship (B1); ✓ otherwise.

**Clinician/GP:** ✓ generally well-gated.

**Psychiatrist:** 🔴 5P formulations inherit CLINICAL_ROLES (B4) — readable by psychologist.

**Psychologist:** 🟠 No outcome measures routes (A2); 🟠 No medication observation endpoint (A1); inherits sensitive MHA access via CLINICAL_ROLES (GAP-C4).

**Clinic Manager:** 🔴 /reports/admin-overview exposes per-clinician activity without admin gate (B3); 🟠 cannot view appointment schedules for rostering (A3).

**Medical Director:** ✓ properly scoped; break-glass immutable audit; governance dashboard live.

---

## 10 — RECOMMENDED FIX SEQUENCING

### Tier 1 — PRODUCTION BLOCKERS (must fix before v1.1.1 tag)

1. [CRIT-H3 / B3] `reportsRoutes.ts:70` — add `requireRoles(['admin','superadmin'])`. 5-line fix.
2. [CRIT-H1 / B1] `nurseFeatureRoutes.ts:54-100` — add `requirePatientRelationship(auth, patientId)` to MAR endpoint. ~15 lines.
3. [CRIT-H4 / B4] `psychiatristFeatureRoutes.ts:156-172` — change role list to `['psychiatrist','admin','superadmin']`. 1-line fix + add `shared_with_clinicians` migration.
4. [HIGH-J1] **Bug 2 Viva activation** — `activate_screen.dart:40-59` rewrite error handling. ~25 lines. 1hr.

### Tier 2 — HIGH (next sprint)

5. Migrate risk/escalations/tasks services to AuthContext (HIGH-D1/2/3) — 2-3 days.
6. Fix 5 silent env-fallback integrations (CRIT-A1) — 1 day.
7. Add offline write queue for Viva vitals (HIGH-J3) — 4 hours.
8. Add Sara scribe consent dialog + recording indicator (CRIT-G1 + HIGH-G3 + HIGH-J4) — 6 hours.
9. Add AI model-version checkpoint locking (CRIT-G3) — 1 day.
10. Add AI feature kill switch via `clinic_feature_flags` (HIGH-G2) — 1 day.

### Tier 3 — MEDIUM (backlog)

11. Letter generator sensitive-data gating (CRIT-G2) — migration + UI — 2 days.
12. Mental-health confidentiality schema (MED-H1-5) — add sensitivity_level columns + role gates — 2 days.
13. Missing Medicare/HealthLink/Radiology integrations (HIGH-I1, HIGH-I2) — scoped as separate phase.
14. Literal query-key refactor (MED-C1) + pre-commit guard — 4 hours.
15. PatientRegistrationWizard 17× `as any` refactor (HIGH-A1) — 2 hours.

### Tier 4 — STRUCTURAL (quarterly)

16. CLAUDE.md drift cleanup (MED-K1).
17. Refresh gold-standard reports.
18. `/api/v1/health/integrations` endpoint.
19. Drift Queue pattern for all mobile write paths.

---

## 11 — APPENDIX: per-agent output files

| Agent | Focus | File |
|---|---|---|
| A | Static analysis (as any, @ts-ignore, hardcoded, silent catches, fire-and-forget) | `/tmp/signacare-audit/agent-A-findings.md` |
| B | Schema drift + camelCase/snake_case mismatches | `/tmp/signacare-audit/audit-agent-B.md` |
| C | React Query hooks + invalidations | `/tmp/signacare-audit/agent-C-findings.md` |
| D | Auth context + RBAC gaps | `/tmp/signacare-audit/agent-D-findings.md` |
| E | (Merged into F) orphan tables | — |
| F | Regression + orphan tables | `/tmp/signacare-audit/audit-agent-F.md` |
| G | AI modules (Scribe / Letters / Chat / Training) | `/tmp/signacare-audit/agent-G-findings.md` |
| H | Persona RBAC matrix | `/tmp/signacare-audit/agent-H-findings.md` |
| I | Integration health | `/tmp/signacare-audit/agent-I-findings.md` |
| J | Mobile (Sara + Viva) | `/tmp/signacare-audit/agent-J-findings.md` |
| K | Documentation cleanup | `/tmp/signacare-audit/audit-agent-K.md` |
