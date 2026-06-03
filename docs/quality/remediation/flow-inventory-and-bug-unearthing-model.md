# Full Flow Inventory and Systematic Bug-Unearthing Model

**Date:** 2026-05-15  
**Purpose:** Authoritative flow inventory + repeatable hidden-bug discovery model across all major process surfaces (UI, API, schedulers/workers).  
**Source of truth:** `apps/web/src/router.tsx`, `apps/api/src/server.ts`, route modules under `apps/api/src/features` + `apps/api/src/integrations`, and job runtime under `apps/api/src/jobs`.

## 1) Scope and Confidence

- UI route inventory extracted from router: **67 routes**.
- API mounted prefix inventory extracted from server: **84 prefixes**.
- Job runtime inventory extracted from schedulers/workers: **20 schedulers**, **8 workers**.
- Confidence: **HIGH** for entry-point coverage (mount-level), **MEDIUM** for deep branch-path coverage (feature-flag/runtime-condition dependent).

## 2) Complete Flow Inventory (Family-Level)

### Traceability for requested clinical-operational flows
- Note writing: `F10` (clinical notes/drafts), plus `F21` for voice/scribe-assisted note creation.
- Correspondence/letter writing: `F15` (correspondence), plus `F21` (`/letters`, structured letter paths).
- SMS/text messaging: `F15` (notifications/messages), `F22` (patient-app notification consumption), `F23` (ACS/FCM/outreach integrations).
- Reception workflow: `F09` (appointments/check-in/waitlist), `F06` (list status transitions), `F08` (referral intake queue), `F17` (handover operational touches).
- Escalation of care: `F11` (risk/safety), `F15` (escalation-notification delivery), `F24` (scheduler/worker emission reliability).
- Assessments and rating scales: `F11` (risk assessments), `F16` (assessment templates/checklists/workflows), `F12` (AIMS/medication safety), `F19` (outcome reporting trends).

## F01 — Auth and Session Lifecycle
- UI: `/login`, `/mfa`, `/change-password`.
- API: `/auth`, `/admin/impersonate`.
- Includes: login, MFA setup/verify/disable, token refresh, password change, impersonation start/end.

## F02 — RBAC and Access Governance
- UI guarded surfaces: `/power-settings`, `/org-settings`, `/staff-assignments`, `/audit`, `/manager-dashboard`, `/clinical-notes`.
- API: role feature routes, break-glass under `/auth`, policy-gated feature routes, `/power-settings/clinics/:id/access-admins`.
- Includes: route-level authorization, persona visibility, break-glass lifecycle, deny-by-default paths.

## F03 — Clinic Onboarding and Subscriber Provisioning
- UI: Power Settings onboarding wizard in `/power-settings`.
- API: `/provisioning`, `/power-settings`, `/clinic-settings`, `/clinics`, `/settings`.
- Includes: clinic create, admin create, branding/modules/specialties bootstrap, subscriber settings.

## F04 — Staff Lifecycle and Team Assignment
- UI: `/staff-assignments`, parts of `/settings`, `/power-settings`.
- API: `/staff`, `/staff-settings`, `/org-settings`.
- Includes: staff create/edit/disable, role assignment, team assignment, discipline/policy linkage.

## F05 — Patient Registration and Demographics
- UI: `/patients`, `/patients/:id`.
- API: `/patients`, `/patients` duplicate check/merge and related status/aux routes.
- Includes: patient create/edit/search, duplicate detection, demographic updates, sensitive field integrity.

## F06 — Patient Status and Queue Flows
- UI: `/list/admission-waitlist`, `/list/hotspots`, `/list/*`.
- API: patient status routes, waitlist/hotspot endpoints.
- Includes: flag for admission, admit/remove, hotspot resolve, list cohort transitions.

## F07 — Episode Lifecycle
- UI: `/episodes/:id`, patient detail episode surfaces, task sign/close touchpoints.
- API: `/episodes`, workflow and checklist integrations as related.
- Includes: episode create/open/transition/close, discharge summary sign path, transition invariants.

## F08 — Referral Lifecycle and Intake
- UI: `/referrals`, `/referrals/:id`, `/referrals/queue`, `/referrals/my-offers`.
- API: `/referrals`, `/ereferrals`, referral allocations, attachments, intake transitions.
- Includes: referral intake, allocation, accept/reject, status transition, queue synchronization.

## F09 — Appointment, Calendar, and Waitlist
- UI: `/appointments`, `/calendar`, receptionist check-in surfaces.
- API: `/appointments`, `/calendar`, `/waitlist`.
- Includes: appointment CRUD, status changes, check-in, calendar sync, waitlist moves.

## F10 — Clinical Notes and Drafting
- UI: `/clinical-notes`, `/drafts`, patient detail note tabs.
- API: `/clinical-notes`, note sign/amend flows, note-related patient endpoints.
- Includes: create/edit/sign/amend/delete, draft lifecycle, audit and immutability constraints.
- Concrete flows: psychiatrist/receptionist note creation paths, voice-memo note writes, note-to-correspondence source extraction.

## F11 — Risk and Safety Plans
- UI: `/risk`, patient detail risk and legal tabs.
- API: `/risk-assessments`, `/safety-plans`, risk-by-patient routes.
- Includes: risk assessment create/update, safety plan authoring, failure/unauthorized handling.
- Concrete flows: risk assessment completion gates, escalation trigger prerequisites, negative-path deny checks for stale/unauthorized risk actions.

## F12 — Medication and Prescribing Safety
- UI: `/medications`, `/clozapine`, `/lai`, `/pathology`, psychiatrist/nursing medication-linked views.
- API: `/medications`, `/prescriptions`, `/allergies`, `/clozapine`, `/lai`, `/pathology`.
- Includes: prescribe/cancel/cease, clozapine workflows, LAI schedules, pathology acknowledgment.

## F13 — Procedure and Specialty Clinical Domains
- UI/API specialty flows exposed under domain pages/services.
- API: `/ect`, `/tms`, `/oncology`, `/internal-medicine`, `/endocrinology`, `/paediatrics`, `/obs-gyne`, `/surgery`.
- Includes: specialty workflow transitions and specialty-specific safety checks.

## F14 — Legal, Advance Directive, and Review Workflows
- UI: clinical/legal tabs and supporting pages.
- API: `/legal` routes via patient mount, `/advance-directives`, `/clinical-review`, `/outcomes`, `/clinical-decision`.
- Includes: legal order updates, AD lifecycle, review capture, clinical decision support actions.

## F15 — Tasks, Messages, and Correspondence
- UI: `/tasks`, `/messages`, `/correspondence`.
- API: `/tasks`, `/messages`, `/correspondence`, `/notifications`.
- Includes: task create/update/complete, message flow, letter/correspondence generation and delivery states.
- Concrete flows: letter template selection/composition/send, notification fanout, receptionist task/message handoffs.

## F16 — Templates, Checklists, and Workflow Definitions
- UI: `/templates`, `/templates/:id`.
- API: `/templates`, `/checklists`, `/workflows`, relevant `/staff-settings` template-category endpoints.
- Includes: template CRUD/publish/use, checklist definitions, workflow command and transition surfaces.
- Concrete flows: rating-scale template seed/use (PHQ-9/GAD-7/K10/HoNOS/BPRS/AIMS), assessment checklist lifecycle, workflow template enforcement.

## F17 — Bed Board, Group Therapy, Nursing, Handover, Case Management
- UI: `/bed-board`, `/group-therapy`, `/nursing`, `/handover`, `/case-management`, `/community-resources`.
- API: `/beds`, `/group-therapy`, related nursing/shift-handover endpoints, care-plan endpoints.
- Includes: admit/discharge/leave bed transitions, group session lifecycle, handover and care-plan writes.

## F18 — Reallocation and Organisational Operations
- UI: org/team operational views in list pages and assignments.
- API: `/reallocations`, `/org-settings`, `/staff-settings` assignment and transition paths.
- Includes: team reassignment, ownership transfer, reallocation approvals and audit.

## F19 — Reporting, Audit, Exports, Compliance
- UI: `/reports`, `/reports/compliance`, `/exports`, `/audit`, `/dashboard`.
- API: `/reports`, `/audit`, `/exports` surfaces via report/download endpoints, `/dashboard`.
- Includes: operational reports, compliance evidence, audit replay, export generation and access control.

## F20 — Billing, Subscription, License, Backup, Privacy
- UI: `/billing`, `/subscription`, `/settings`.
- API: `/billing`, `/license`, `/backup`, `/privacy`, plus subscription endpoints under `/power-settings`.
- Includes: plan/seat handling, license checks, backup config/location paths, privacy controls.

## F21 — AI/LLM/Scribe/Voice/Mobile
- UI: `/ai-agent`, `/voice`, `/m/scribe`, `/m/scribe/:patientId`.
- API: `/llm`, `/ai`, `/scribe`, `/letters`, `/clinical` (structured letter paths), `/voice`, training endpoints.
- Includes: AI assist, scribe sessions/streaming, letter generation, feedback, guardrails and patient relationship checks.
- Concrete flows: AI-assisted note drafting, structured referral/correspondence letter generation, mobile scribe capture and submission.

## F22 — Patient App (External User Flow)
- UI: patient app external client surface (separate from clinician web router).
- API: `/patient-app`.
- Includes: activation, login, token/session, patient self-service data access flows.

## F23 — Integrations and Interop
- API: `/fhir`, `/hi-service`, `/integrations/outlook`, `/cmi`, `/nhsd`, `/webhooks`, `/webhooks-admin`.
- Includes: FHIR resources and SMART auth, HI service calls, Outlook connect/disconnect, external webhook delivery.
- Concrete flows: SMS/push delivery plumbing (ACS/FCM), patient-outreach dispatch, outbound interop reliability and fail-visible behavior.

## F24 — Platform Runtime and Eventing
- API: `/events` (SSE), `/feature-flags`, `/feature-flags-admin`, `/csp-report`, health/ready checks.
- Jobs: schedulers + workers under `apps/api/src/jobs`.
- Includes: event streams, feature flag control, background execution, queue workers, scheduled critical checks.

## 3) Systematic Bug-Unearthing Model (Global Baseline for Every Flow)

Apply this baseline to **every** family F01–F24:

1. **Happy path proof:** create/update/read cycle succeeds end-to-end.
2. **Typed failure proof:** bad input/authz/state returns explicit `4xx/409/422`, never opaque `500`.
3. **Unauthorized proof:** out-of-role actor gets deterministic deny and no side effects.
4. **Concurrency proof:** duplicate submit/race/retry does not corrupt state (idempotent or conflict-typed).
5. **Data invariant proof:** DB constraints and tenant isolation hold after each mutation.
6. **Audit proof:** mutation emits exactly one canonical audit record (or explicit no-audit contract).
7. **Observability proof:** errors are structured and diagnosable (code, cause, correlation id).
8. **Cold-start proof:** tests pass from clean boot (`clone -> install -> run`) with no session residue.

## 4) Per-Family Bug-Unearthing Model (Specific Focus)

## F01 Auth and Session
- Probe set: invalid credential, expired session, MFA mismatch, refresh replay, lockout threshold.
- Hidden bug targets: stale token acceptance, silent MFA bypass, inconsistent session revocation.

## F02 RBAC and Access Governance
- Probe set: role matrix for each protected page/endpoint, break-glass require/approve/revoke negative paths.
- Hidden bug targets: route-level bypass, FE/BE divergence, cross-clinic read leak.

## F03 Onboarding and Provisioning
- Probe set: clinic create with duplicate/non-duplicate admin emails, malformed HPI-O variants, bootstrap partial-failure rollback.
- Hidden bug targets: missing unique constraints assumptions, bootstrap table optionality drift, opaque 500 on known conflicts.

## F04 Staff Lifecycle
- Probe set: add/edit/deactivate/reactivate, duplicate email per clinic/global, role/discipline mutation constraints.
- Hidden bug targets: stale assignment records, global-vs-tenant uniqueness mismatch, policy drift after edit.

## F05 Patient Registration
- Probe set: create/edit with duplicate detection race, merge flows, mandatory-field and identifier format checks.
- Hidden bug targets: duplicate patient creation under concurrency, irreversible merge side effects, encrypted-field lookup regressions.

## F06 Patient Status/Queues
- Probe set: waitlist add/remove/admit, hotspot resolve/reopen, list transition retries.
- Hidden bug targets: stale status rendering, split-brain status between list and patient detail, missing audit on status changes.

## F07 Episode Lifecycle
- Probe set: open->transition->close->reopen scenarios with concurrent actors.
- Hidden bug targets: invalid transition acceptance, missing terminal-state guards, duplicate close events.

## F08 Referral Lifecycle
- Probe set: intake/create/allocate/accept/reject/cancel with role matrix and clinic boundary matrix.
- Hidden bug targets: allocation without authority, orphan transitions, attachment/state mismatch.

## F09 Appointments/Calendar/Waitlist
- Probe set: create/reschedule/cancel/check-in under concurrent edits and timezone boundaries.
- Hidden bug targets: double-booking, stale status after check-in, calendar sync drift.

## F10 Clinical Notes/Drafts
- Probe set: create/sign/amend/delete with optimistic-lock conflicts and signature failures.
- Hidden bug targets: sign on stale version, amendment immutability breaks, draft deletion side effects.

## F11 Risk/Safety Plans
- Probe set: risk capture update cadence, outdated-risk gate where required, safety plan lifecycle.
- Hidden bug targets: false “green” status with failed fetch, missing required risk checkpoints.

## F12 Medication/Prescribing
- Probe set: prescribe/cease/cancel for authorized vs unauthorized disciplines; allergy conflict checks.
- Hidden bug targets: policy denial surfacing as 500, partial write on denial, unsafe override gaps.

## F13 Specialty Clinical Domains (ECT/TMS/Oncology/etc.)
- Probe set: specialty-specific state transitions and required data completeness.
- Hidden bug targets: cross-specialty schema assumptions, missing specialty gate checks.

## F14 Legal/AD/Review
- Probe set: legal order create/update/expire, AD creation and access gating, review closure.
- Hidden bug targets: hidden side-effects in read endpoints, unauthorized legal visibility, incomplete audit trail.

## F15 Tasks/Messages/Correspondence
- Probe set: task create/edit/complete double-submit, message send retry, correspondence publish/send paths.
- Hidden bug targets: duplicate dispatch, optimistic UI false success, stale unread counters.

## F16 Templates/Checklists/Workflows
- Probe set: template CRUD + publish state, checklist and workflow definition consistency.
- Hidden bug targets: template type drift, workflow definition-version mismatch at runtime.

## F17 Beds/Group Therapy/Nursing/Handover/Case Mgmt
- Probe set: bed transitions, group attendee updates, handover saves, care plan writes with race conditions.
- Hidden bug targets: orphan assignments, patient-location inconsistency, partial transition writes.

## F18 Reallocation/Org Ops
- Probe set: reassignment authorization, bulk reallocation with partial failures, rollback behavior.
- Hidden bug targets: cross-tenant transfers, unowned patients after failed multi-step moves.

## F19 Reporting/Audit/Exports
- Probe set: report parameter validation, export authz, audit replay integrity, large result pagination.
- Hidden bug targets: PHI overexposure, stale export links, inconsistent audit pagination counts.

## F20 Billing/Subscription/License/Backup/Privacy
- Probe set: plan changes, seat changes, backup config mutations, privacy operations.
- Hidden bug targets: subscription-state drift, backup schedule misconfiguration silently accepted.

## F21 AI/LLM/Scribe/Voice/Mobile
- Probe set: patient relationship checks, prompt redaction, session resume/retry, streaming interruptions.
- Hidden bug targets: PHI leakage in logs, assistant action without authorization context, stale session reuse.

## F22 Patient App
- Probe set: activation/login/token refresh, patient-scoped reads/writes from app identity.
- Hidden bug targets: token scope escalation, stale account status acceptance.

## F23 Integrations/Interop
- Probe set: outbound retry/dead-letter behavior, credential/config absence, webhook signature validation.
- Hidden bug targets: silent transport failures, partial delivery with success response, endpoint drift.

## F24 Platform Runtime/Eventing/Jobs
- Probe set: scheduler emission, worker retry/DLQ, SSE lifecycle, feature-flag fallbacks.
- Hidden bug targets: silent drop paths, duplicate execution, fail-open probes.

## 5) Execution Order for Unearthing Hidden Bugs (Recommended)

1. F03 onboarding + F04 staff (already showing hidden defect density).
2. F05/F07/F08/F12 core clinical mutation surfaces.
3. F17 operational clinical logistics (beds/group/nursing/handover).
4. F21 AI/LLM + F23 integrations.
5. F24 schedulers/workers and global cold-start replay.

## 6) Required Evidence Pack per Flow Family

For each family closure attempt, attach:

- route/page list exercised
- happy-path logs
- negative-path logs (typed error proof)
- DB invariant query output
- concurrency replay result
- audit evidence
- CI run links (L1-L5 relevant subset)

---

## Appendix A — Full UI Route Inventory (67)

`/login`, `/mfa`, `/change-password`, `/`, `/dashboard`, `/patients`, `/patients/:id`, `/episodes/:id`, `/appointments`, `/calendar`, `/referrals`, `/referrals/queue`, `/referrals/my-offers`, `/referrals/:id`, `/clinical-notes`, `/templates`, `/templates/:id`, `/escalations`, `/risk`, `/medications`, `/lai`, `/clozapine`, `/pathology`, `/billing`, `/tasks`, `/messages`, `/correspondence`, `/clinical-review`, `/reports`, `/reports/compliance`, `/settings`, `/power-settings`, `/org-settings`, `/staff-assignments`, `/voice`, `/audit`, `/subscription`, `/ai-agent`, `/drafts`, `/exports`, `/list/lai`, `/list/mha`, `/list/clozapine`, `/list/referrals`, `/list/acis`, `/list/parc`, `/list/ccu`, `/list/ipu`, `/list/op`, `/list/group`, `/list/cloz-support`, `/list/91day`, `/list/hotspots`, `/list/admission-waitlist`, `/group-therapy`, `/bed-board`, `/pathways`, `/handover`, `/receptionist`, `/nursing`, `/case-management`, `/community-resources`, `/psychiatrist`, `/manager-dashboard`, `/m/scribe`, `/m/scribe/:patientId`, `*`.

## Appendix B — Full API Mounted Prefix Inventory (84)

`/admin/impersonate`, `/admin/training`, `/advance-directives`, `/ai`, `/appointments`, `/audit`, `/auth`, `/backup`, `/beds`, `/billing`, `/calendar`, `/calendar/ical`, `/carers`, `/checklists`, `/clinic-settings`, `/clinical`, `/clinical-decision`, `/clinical-notes`, `/clinical-review`, `/clinics`, `/clozapine`, `/cmi`, `/contact-records`, `/correspondence`, `/csp-report`, `/dashboard`, `/documents`, `/ect`, `/endocrinology`, `/episodes`, `/ereferrals`, `/escalations`, `/events`, `/feature-flags`, `/feature-flags-admin`, `/fhir`, `/group-therapy`, `/hi-service`, `/imports`, `/integrations/outlook`, `/internal-medicine`, `/lai`, `/letters`, `/license`, `/llm`, `/medications`, `/messages`, `/mobile`, `/nhsd`, `/notifications`, `/obs-gyne`, `/oncology`, `/org-settings`, `/outcomes`, `/paediatrics`, `/pathology`, `/pathways`, `/patient-app`, `/patient-outreach`, `/patients`, `/power-settings`, `/prescriptions`, `/privacy`, `/provisioning`, `/reallocations`, `/referrals`, `/reports`, `/risk-assessments`, `/safety-plans`, `/scribe`, `/settings`, `/staff`, `/staff-settings`, `/surgery`, `/tasks`, `/telehealth`, `/templates`, `/tms`, `/voice`, `/waitlist`, `/webhooks`, `/webhooks-admin`, `/workflows`.

## Appendix C — Background Runtime Flow Inventory

### Schedulers (20)
- `advanceDirectiveReviewScheduler`
- `appointmentReminderScheduler`
- `audioRetentionScheduler`
- `auditOutboxDrainer`
- `backupScheduler`
- `clinicAdminSlotBootstrapCheck`
- `clozapineAlertScheduler`
- `clozapineMonitoringWeekScheduler`
- `dataRetentionScheduler`
- `ectConsentExpiryScheduler`
- `laiAlertScheduler`
- `matviewRefreshScheduler`
- `mhaReviewScheduler`
- `pathologyCriticalScheduler`
- `prescriptionRepeatScheduler`
- `referralSlaScheduler`
- `runScheduledTick`
- `suicidalIdeationAfterHoursScheduler`
- `therapeuticLevelMonitoringScheduler`
- `workflowOutboxDrainer`

### Workers (8)
- `aiWorker`
- `emailWorker`
- `flagWorker`
- `hl7Worker`
- `llmWorker`
- `outlookWorker`
- `patientOutreachWorker`
- `sessionCleanupWorker`
