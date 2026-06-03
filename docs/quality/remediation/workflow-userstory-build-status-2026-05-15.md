# Workflow + User Story Build Status (Pre-Deployment Deep Walkthrough)

**Date:** 2026-05-15  
**Mode:** Execution + status (pre-deployment local)  
**Build context:** not deployed, demo data only, external integrations not configured

> Update (2026-05-16): stale harness cleanup + selector hardening were executed.
> Persona fixtures were normalized (`superadmin/admin/manager/receptionist/clinician`),
> login selectors were made fail-safe, appointment creation test flow was stabilized,
> and full workflow/probe reruns were completed.
>
> Update (2026-05-17): patient-list/patient-summary hardening landed (consultant sign-off + reminder task path, diagnosis summary card, risk/allergy banner default removal, referral split/intake command regression packs). Typecheck/lint/targeted integration suites are green. `guard:all` is green except one legacy backlog gate (`guard:file-size`) on four pre-existing oversized files (`llmRoutes.ts`, `ambientProcessor.ts`, `AmbientAiRecorder.tsx`, `EditPatientWizard.tsx`).
>
> Update (2026-05-17): legacy file-size guard debt was structurally remediated (`llmRoutes` HF route modularization, `ambientProcessor` LOC trim, `AmbientAiRecorder` view-part extraction, `EditPatientWizard` steps/types extraction). `guard:file-size` is now green and `guard:all` replays green in current local pass.

## 1) Evidence Run (What Was Actually Executed)

### Input documents reviewed
- `/Users/drprakashkamath/Library/CloudStorage/OneDrive-SouthYarraFamilyDentalCare/Desktop/worflow.txt`
- `/Users/drprakashkamath/Library/CloudStorage/OneDrive-SouthYarraFamilyDentalCare/Desktop/User Stories Document.pdf`

### Runtime/static validation executed in this pass
1. Representative API integration suites (auth, RBAC, onboarding, episodes, referrals, notes/risk, prescribing, scheduler, patient-app, integration config).
2. Full workflow Playwright set:
   - `e2e/01-auth` .. `e2e/11-mar-write-rail` executed in two passes:
     - core pack (`01,02,03,04,05,06,08,09,10,11`): 68 tests
     - medications pack (`07-medications`): 8 tests
     - total: 76 tests
3. Probe Playwright set:
   - `api-contract`, `route-crawler`, `rbac-matrix`, `save-round-trip`, `double-submit` (95 tests).
4. Static code verification for known critical surfaces:
   - email worker implementation presence.
   - payment/Stripe presence.
   - role/persona model coverage.
   - family/support-worker auth surfaces.

## 2) Executive Status

### Current runtime snapshot
- **Probe suite:** `95/95 passed`.
- **Primary workflow UI suite:** `76/76 passed`.
- **Representative integration suites (Phase-0 representative pack):** `4/4 passed`.
- **Critical interpretation:** harness fragility defects have been materially reduced; remaining risk is now mainly runtime warning clusters and known pre-deployment scope gaps (integrations, payments, family/support personas).

### Representative integration suite status refresh
- `tests/integration/clinicalAccessRbac.int.test.ts` passes in current local replay (`17/17`).
- `tests/integration/provisioningOnboarding.int.test.ts`, `patientCrud.test.ts`, and `episodeStateMachine.test.ts` all pass in current replay.

## 3) Workflow Status (Current Build)

| Workflow Family | Status | Evidence |
|---|---|---|
| F01 Auth/session | **Verified Working (local)** | `e2e/01-auth` passed (6/6), auth integration passed. |
| F02 RBAC/access governance | **Verified Working (local)** | `rbac-matrix` probe passed (25/25); `clinicalAccessRbac.int.test.ts` passed (17/17). |
| F03 Clinic onboarding/provisioning | **Partial** | `provisioningOnboarding.int.test.ts` passed; strict HPI-O validation enforced; onboarding emails still blocked by email worker stub. |
| F04 Staff lifecycle/assignment | **Verified Working (local smoke)** | Admin/staff pages now pass in workflow pack (`e2e/09-admin`). |
| F05 Patient registration/demographics | **Verified Working (local smoke)** | `patientCrud.test.ts` passed; patient workflow e2e spec now passes end-to-end. |
| F06 Queues/lists/status | **Partial** | route/list surfaces are stable in probes and workflow pack; deeper acceptance criteria still pending per user-story depth. |
| F07 Episode lifecycle | **Verified Working (local smoke)** | `episodeCreateConflict` + `episodeStateMachine` integration passed; episode workflow e2e suite now passes. |
| F08 Referral lifecycle | **Verified Working (local core)** | Referral e2e flow passed (create/accept/status/search); referral RBAC/state-machine integrations passed. |
| F09 Appointments/calendar/waitlist | **Verified Working (local smoke)** | Appointments + tasks workflow spec now passes end-to-end. |
| F10 Clinical notes/drafts | **Partial** | note/risk gate integrations passed and episodes+notes workflow passes; permission-warning noise remains in console for some patient-detail side queries. |
| F11 Risk/safety plans | **Verified Working (local smoke)** | Alerts & Plans workflow suite now passes end-to-end. |
| F12 Medication/prescribing | **Verified Working (local core) + known compliance gaps** | Medications e2e passed; prescribing integrations passed. Remaining known gaps still include external DDI/interop maturity. |
| F13 Specialty domains | **Partial** | route-crawler reaches specialty surfaces; not all specialty deep flows fully replayed in this pass. |
| F14 Legal/AD/review | **Partial** | supporting integration coverage exists; not all user-story acceptance criteria replayed end-to-end in this pass. |
| F15 Tasks/messages/correspondence | **Verified Working (local smoke)** | correspondence + tasks workflows pass; save-roundtrip + double-submit probes pass. |
| F16 Templates/checklists/workflows | **Partial** | template/admin route smoke is green; deep workflow acceptance criteria still pending. |
| F17 Bed board/group therapy/nursing/handover/case mgmt | **Verified Working (local smoke)** | clinical-lists workflow and route-crawler specs now pass. |
| F18 Reallocation/org ops | **Partial** | route surface loads; deep workflow replay pending. |
| F19 Reporting/audit/exports | **Partial** | reports/audit/exports pages and probes pass at route/API level; full business-intelligence acceptance criteria still incomplete. |
| F20 Billing/subscription/license | **Partial** | subscription page + save-roundtrip passes; payment processor not integrated, so full billing story set not complete. |
| F21 AI/scribe/voice | **Partial** | route-level health is good; full clinical-grade acceptance and compliance posture still pending. |
| F22 Patient app | **Mostly Working (patient model) + scope gap** | patient-app auth/ownership integrations pass; family-member auth model still absent. |
| F23 Integrations/interop | **Pre-deployment blocked/partial by design** | no real external integration env configured; `productionIntegrationConfig` confirms missing integrations tolerated outside production. |
| F24 Runtime/jobs/eventing | **Partial with one major blocker** | core probes pass; **email worker remains stub**, so reminder/notification families are not fully operational. |

## 4) User Story Status (Current, Evidence-Weighted)

## A) Verified functional (local core behavior proven)
- `US-PA-002` clinic onboarding core transaction path (creation path) is working locally.
- `US-CL-013` core prescribing lifecycle locally working (with known external/compliance limitations).
- `US-CL-015` referral intake/status core path locally working.
- `US-PT-005` secure messaging/task transport surface locally functioning at API/probe level.
- `US-IT-001` FHIR route set remains wired (local route + contract evidence present).

## B) Verified broken/gap (current hard blockers confirmed)
- `US-WF-001`, `US-WF-002`, `US-WF-003`: blocked by **stubbed email worker**.
- `US-PT-007` and payment aspects of `US-CL-017`: **no Stripe/payment processor integration**.
- `US-FM-001`..`US-FM-004`: family-member auth/workflow surface still absent (patient-app is patient-bound model).
- `US-SS-001`, `US-SS-002`: support-worker persona/workflow model still absent in canonical RBAC.
- `US-PA-006`: support ticket feature still absent.

## C) Functional-but-needing deeper scenario coverage
- `US-CL-007`, `US-CL-008`, `US-PT-002`, `US-CL-012`, `US-PT-003`, `US-CL-011`, `US-CL-010`, `US-PT-001`, `US-PT-006`, `US-PT-008`, `US-PT-009`, `US-CL-004`, `US-CL-005`, `US-CL-006`, `US-RP-001`..`US-RP-004`, `US-SC-001`..`US-SC-004`.
- Reason: core workflow packs now pass, but these stories still need richer, role-depth acceptance replay (beyond smoke and happy-path coverage) before closure claims.

## 5) Delta vs Prior `worflow.txt` Review

The earlier review is now partially stale in both directions:

1. **Improved vs prior:** referral and prescribing local workflow execution evidence is materially stronger.
2. **Still true from prior:** no real payment integration, no family/support-worker persona implementation, email worker blockage.
3. **New discovery in this pass:** runtime warnings still surface in UI replay (`MUI out-of-range select values`, patient-detail side `403 relationship/risk` noise, and MAR path `GET medication-administrations -> 404`), which should be triaged as product/runtime debt even when tests pass.

## 6) Regression-Proof Posture Observed

### What is strong
- Guard/probe infrastructure is substantial and actively catching drift.
- Route/API stability probes are broad and currently green.
- Core integration suites across critical clinical flows are largely green.

### What is weak
- Runtime warning hygiene is the top remaining regression risk:
  - repeated MUI out-of-range warnings in patient/episode flows,
  - repeated patient-detail side 403 noise during cross-feature tabs,
  - MAR flow still tolerates a `medication-administrations` 404 during page load.

## 7) Immediate Next Actions

1. Keep hard blockers explicit in bug ledger:
   - email worker implementation,
   - payment integration,
   - family/support-worker persona surfaces.
2. Open/track runtime warning debt bugs for:
   - out-of-range select values in patient/episode flows,
   - patient-detail side noisy 403 fetches when relationship/risk access is unavailable,
   - MAR load path `medication-administrations` 404 handling.
3. For full user-story signoff pre-deployment, keep role-matrix workflow reruns mandatory (superadmin/admin/manager/receptionist/clinician).
4. Keep BUG-528 ceiling ratchet maintenance current:
   - apply ceiling-drop follow-up for files now far below legacy ceilings when planned (`check-file-size` notices).

## 8) T2–T23 Execution Status (Current)

| Task | Status | Notes |
|---|---|---|
| T2 Persona fixtures truthful | ✅ Completed | Canonical personas wired and used in e2e fixtures. |
| T3 UI selector contract hardening | ✅ Completed (critical pack) | Login + appointment selectors hardened; `guard:e2e-selector-stability` passes. |
| T4 Repair stale integration tests | ✅ Completed (representative set) | `clinicalAccessRbac`, `provisioningOnboarding`, `patientCrud`, `episodeStateMachine` all pass. |
| T5 Harness-only fail-visible doubles | ✅ Completed (harness posture) | Tests fail visibly; known missing integrations still tracked as product blockers (not hidden). |
| T6 Phase-0 gate replay | ✅ Completed | `lint`, `typecheck`, targeted representative integrations are green. `guard:all` and `guard:file-size` are green in current replay. |
| T7 Day-10 escalation trigger | ⏳ Not triggered | Used only if Phase-0 exit gates are not green by day-10 cutoff. |
| T8 RDX-0 regulatory discovery output | ✅ Completed | `docs/quality/remediation/evidence/a3-csr-3-discovery-gate-2026-05-15.md`. |
| T9 Module 1 (Access shell/RBAC/nav) | ✅ Completed (local smoke) | Auth + RBAC matrix + admin/access routes green in current replay. |
| T10 Module 2 (Clinic onboarding/power settings) | ✅ Completed (local smoke) | Provisioning integration + power settings/admin route checks green. |
| T11 Module 3 (Patient registration/profile) | ✅ Completed (local smoke) | Patient CRUD integration + patient workflow e2e green. |
| T12 Module 4 (Episodes/notes/risk/consent gates) | ✅ Completed (local smoke) | Episode + note flows green; consent/risk integration gates pass. |
| T13 Module 5 (Referrals/intake/allocation) | ✅ Completed (local smoke) | Referral workflows and integration paths pass. |
| T14 Module 6 (Appointments/check-in/waitlist/tasks) | ✅ Completed (local smoke) | Appointments/tasks workflows pass after selector hardening. |
| T15 Module 7 (Alerts/plans/assessments/scales) | ✅ Completed (local smoke) | Alerts/plans workflow suite passes end-to-end in replay. |
| T16 Module 8 (Correspondence/letters/messages) | ✅ Completed (local smoke) | Correspondence workflows and messaging saves pass. |
| T17 Module 9 (Medications/prescribing/pathology safety) | ✅ Completed (local smoke) | MAR write-rail + prescribing-related local packs pass; external/regulatory depth still pending. |
| T18 Module 10 (Billing/payments/revenue) | ⏳ Pending full closure | Billing route smoke is green; payment processor integration remains absent. |
| T19 Module 11 (Patient app/family workflows) | ⏳ Pending full closure | Patient-app ownership paths pass; family/support persona flows still absent. |
| T20 Module 12 (Reporting/audit/compliance exports) | ⏳ Pending full closure | Route smoke is green; full business acceptance and data-quality proof pending. |
| T21 Module 13 (External integrations/regulatory closure) | ⏳ Pending | Requires deployed integration environment and regulated workflow evidence. |
| T22 weekly cold-start enforcement | ✅ Completed | Scheduled workflow exists at `.github/workflows/weekly-integrity.yml` and runs guard/typecheck/test/lint on weekly cron + manual dispatch. |
| T23 pre-deployment global closeout | ⏳ Pending | Depends on T9–T22 completion. |
