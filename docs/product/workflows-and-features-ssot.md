# Signacare EMR — Workflows and Features SSoT

**Status:** Authoritative  
**Last updated:** 2026-05-24  
**Owner:** Product + Architecture + QA  
**Related:** [`../quality/bugs-remaining.md`](../quality/bugs-remaining.md), [`product-roadmap-ssot.md`](product-roadmap-ssot.md)

## 1) Authority and Change Rules

This is the single source of truth for:

1. Active product workflows.
2. Active product features mapped to workflows.
3. Workflow/feature lifecycle status.

Rules:

1. A workflow or feature is not "active scope" unless it exists in this document.
2. Any workflow/feature change must update this file in the same PR.
3. Risk-bearing changes must include linked test evidence and bug references.
4. Deprecated items must be marked `retired` (never silently removed).

## 2) Workflow Catalog

| Workflow ID | Workflow | Primary Surfaces | Primary Personas | Current State | Evidence Anchor |
|---|---|---|---|---|---|
| WF-2.1 | User Login | API auth, web auth, mobile auth | All users | active | auth integration tests + bug ledger; S0 gates: BUG-WF21-JWT-GHOST-SESSION, BUG-WF21-AUTH-COUNTER-RACE, BUG-WF21-OTP-CAP-MISSING |
| WF-2.2 | Password Reset | auth reset APIs + web flows | Staff, patients | active | auth tests + bug ledger; S0 gates: BUG-WF22-PWD-RESET-MISSING (depends on BUG-WF42-EMAIL-WORKER-STUB) |
| WF-3.1 | Patient Registration | reception/patient create flows | Reception, clinicians | active | patient route tests; S1 gate: BUG-WF31-VALIDATION-MISSING |
| WF-3.2 | Patient Search | patient list/search APIs + UI | Clinicians, managers | active | search tests; no open S0/S1 in current ledger |
| WF-4.1 | Appointment Booking | appointment APIs + calendars | Reception, clinicians | active | booking tests; S0 gate: BUG-WF41-SLOT-RACE; S1 gates: BUG-WF41-REMINDER-TX-ORDER, BUG-WF41-CLINICIAN-NOTIFY-MISSING |
| WF-4.2 | Reminders | scheduler + jobs + notifications | Patients, staff | active | job tests + queue telemetry; S0 gates: BUG-WF42-EMAIL-WORKER-STUB, BUG-WF42-CANCEL-CLEANUP-MISSING; S1 gate: BUG-WF42-OUTREACH-WORKER-RLS-CONTEXT |
| WF-4.3 | Check-in | reception + appointments | Reception | active | reception tests; S1 gates: BUG-WF43-CHECK-IN-COLUMN-MISSING, BUG-WF43-ITEMS-AGGREGATION-MISSING |
| WF-5.1 | Ambient AI Notes | whisper + AI draft + notes | Clinicians | active | AI feature tests + consent checks; S0 gates: BUG-WF51-ATTESTATION-BYPASS, BUG-WF51-CONSENT-REVOKE-RACE, BUG-SCRIBE25-001, BUG-SCRIBE25-002; S1 gates: BUG-SCRIBE25-003, BUG-SCRIBE25-004, BUG-SCRIBE25-005, BUG-SCRIBE25-006 |
| WF-5.2 | Assessments | outcome measures + scoring | Clinicians, patients | active | assessment tests; S0 gate: BUG-WF52-SUICIDE-ALERT-MISSING; S1 gate: BUG-WF52-SCORING-CALCULATOR-MISSING |
| WF-6.1 | Invoice and Payment | billing APIs + reporting | Admin, finance | active | billing tests + bug ledger; S1 gate: BUG-WF61-RECEIPT-EMAIL-MISSING (depends on BUG-WF42-EMAIL-WORKER-STUB) |
| WF-7.1 | Referral Intake | intake APIs + workflows | Referral coordinators | active | referral tests; S0 gate: BUG-WF71-PATIENT-MATCH-NAIVE; S1 gates: BUG-WF71-UPLOAD-MIME-VALIDATION, BUG-WF71-ACK-EMAIL-MISSING, BUG-WF71-EXPIRY-SCHEDULER-MISSING |
| WF-8.1 | ePrescription | prescribing + external integrations | Prescribers | active | prescribing tests + integration gates; S0 gates: BUG-WF81-NPDS-PAYLOAD-ENCRYPTION, BUG-WF81-HPII-MISSING, BUG-ARCH-NPDS-SUBMIT-RETRY, BUG-ARCH-MEDICATION-STATUS-ENUM-DRIFT, BUG-344, BUG-P1; S1 gates: BUG-WF81-DISPENSE-FLOW-MISSING, BUG-WF81-PBS-AUTHORITY-MISSING, BUG-WF81-ASLR-READONLY |
| WF-8.2 | Pathology | HL7 intake + result review | Clinicians | active | pathology tests; no open S0/S1 in current ledger (HL7 inbound BUG-262 family closed; see Section 6 of bugs-remaining.md) |

## 3) Feature Register (Canonical)

Use this schema for all entries.

| Feature ID | Feature Name | Workflow ID(s) | Capability Type | Access Scope | Data Scope | Current State | Validation Evidence | Open Bug Ref |
|---|---|---|---|---|---|---|---|---|
| FEAT-DASH-001 | Dashboard cards and metrics | WF-3.2, WF-4.1, WF-5.2 | UI + API aggregate | role-gated | clinic-scoped | active | dashboard integration + UI tests | BUG-SA-001, BUG-SA-002, BUG-SA-106 |
| FEAT-AI-001 | AI clinical summaries | WF-5.1, WF-5.2 | AI + clinical synthesis | clinical roles | clinic + patient scoped | active | AI endpoint + summary sign-off tests | BUG-WF51-ATTESTATION-BYPASS, BUG-WF51-CONSENT-REVOKE-RACE, BUG-SCRIBE25-001..006, BUG-WF52-SUICIDE-ALERT-MISSING |
| FEAT-TASK-001 | My tasks + team tasks | WF-4.2, WF-4.3, WF-7.1 | workflow/tasking | role-gated | clinic/team scoped | active | task API + UI tests | BUG-SA-001, BUG-SA-011, BUG-WF43-CHECK-IN-COLUMN-MISSING, BUG-WF43-ITEMS-AGGREGATION-MISSING |
| FEAT-GOV-001 | Governance control plane and declutter enforcement | cross-cutting | policy + guard rail | engineering roles | repo-wide | active | governance docs + guard runs + evidence slices | BUG-SA-103, BUG-SA-105, BUG-ARCH-ALLOWLIST-TIMEBOMB-2026-12-31, BUG-D10-GUARD-TRACKED-IGNORED, BUG-D10-GUARD-ZERO-BYTE, BUG-D10-GUARD-ENV-TEMPLATE, BUG-D10-GUARD-XPROJECT-BOUNDARY |

## 4) Workflow/Feature Lifecycle

Allowed states:

- `proposed`: captured, not approved.
- `approved`: accepted for build.
- `in_build`: under implementation.
- `active`: released and supported.
- `deprecated`: replacement available, pending retirement.
- `retired`: not supported; retained only for traceability.

## 5) Mandatory Quality Gates per Change

Every workflow/feature change must pass:

1. L1: build + typecheck + lint.
2. L2: backend integration tests for affected paths.
3. L3: frontend behavior/logic tests for affected surfaces.
4. L4: guard suite (or scoped guards with justification).
5. L5: runtime verification for critical behavior claims.

## 6) Sync Contract with Other SSoTs

When this file changes:

1. Update [`../quality/bugs-remaining.md`](../quality/bugs-remaining.md) for any unresolved or newly discovered defects.
2. Update [`product-roadmap-ssot.md`](product-roadmap-ssot.md) when a change affects planned delivery.
3. Include links to evidence docs under `docs/quality/remediation/evidence/` when applicable.
