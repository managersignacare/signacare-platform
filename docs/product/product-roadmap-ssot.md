# Signacare EMR — Product Roadmap SSoT

**Status:** Authoritative  
**Last updated:** 2026-05-24  
**Owner:** Product + Architecture + QA  
**Related:** [`workflows-and-features-ssot.md`](workflows-and-features-ssot.md), [`../quality/bugs-remaining.md`](../quality/bugs-remaining.md)

## 1) Authority and Scope

This is the single source of truth for:

1. Planned new features.
2. Delivery sequencing (now/next/later).
3. Release readiness state and exit criteria.

Rules:

1. New features must be registered here before implementation starts.
2. Every roadmap item must map to one or more workflow IDs.
3. Every shipped roadmap item must update workflow/feature SSoT and bugs ledger.

## 2) Delivery Stages (Strict)

Roadmap state machine:

1. `proposed`
2. `discovery`
3. `approved`
4. `in_build`
5. `in_validation` (L1-L5 in progress)
6. `release_ready`
7. `released`
8. `post_release_hardening`

## 3) Roadmap Register (Authoritative List)

| Roadmap ID | Initiative | Workflow ID(s) | Priority | Deployment Window | State | Owner | Dependencies | Exit Criteria | Linked Bugs |
|---|---|---|---|---|---|---|---|---|---|
| RM-2026-001 | Auth and session hardening bundle | WF-2.1, WF-2.2 | P0 | pre-deployment | proposed | Security + API | auth + DB migration | no S0 auth gaps | BUG-WF21-JWT-GHOST-SESSION, BUG-WF21-AUTH-COUNTER-RACE, BUG-WF21-OTP-CAP-MISSING, BUG-WF22-PWD-RESET-MISSING, BUG-ARCH-PATIENTAPP-LOGIN-RATE-LIMIT, BUG-ARCH-PATIENTAPP-ACTIVATION-ATTEMPT-CAP |
| RM-2026-002 | Clinical scheduling safety bundle | WF-4.1, WF-4.2, WF-4.3 | P0 | pre-deployment | proposed | Clinical platform | appointments + jobs | booking/reminder safety checks green | BUG-WF41-SLOT-RACE, BUG-WF41-REMINDER-TX-ORDER, BUG-WF41-CLINICIAN-NOTIFY-MISSING, BUG-WF42-EMAIL-WORKER-STUB, BUG-WF42-OUTREACH-WORKER-RLS-CONTEXT, BUG-WF42-CANCEL-CLEANUP-MISSING, BUG-WF43-CHECK-IN-COLUMN-MISSING, BUG-WF43-ITEMS-AGGREGATION-MISSING |
| RM-2026-003 | AI safety and provenance hardening | WF-5.1, WF-5.2 | P0 | pre-deployment | proposed | AI + Clinical safety | AI services + consent | sign-off, consent, audit gates green | BUG-WF51-ATTESTATION-BYPASS, BUG-WF51-CONSENT-REVOKE-RACE, BUG-WF52-SUICIDE-ALERT-MISSING, BUG-WF52-SCORING-CALCULATOR-MISSING, BUG-SCRIBE25-001, BUG-SCRIBE25-002, BUG-SCRIBE25-003, BUG-SCRIBE25-004, BUG-SCRIBE25-005, BUG-SCRIBE25-006 |
| RM-2026-004 | Referral and intake quality hardening | WF-7.1 | P0 | pre-deployment | proposed | Intake domain | matching + uploads + scheduler | match safety + expiry flow green | BUG-WF71-PATIENT-MATCH-NAIVE, BUG-WF71-UPLOAD-MIME-VALIDATION, BUG-WF71-ACK-EMAIL-MISSING, BUG-WF71-EXPIRY-SCHEDULER-MISSING |
| RM-2026-005 | Prescription integration and governance hardening | WF-8.1 | P0 | staged (pre+post) | proposed | eRx domain | external integration contracts | high-risk eRx gaps closed | BUG-WF81-NPDS-PAYLOAD-ENCRYPTION, BUG-ARCH-NPDS-SUBMIT-RETRY, BUG-WF81-HPII-MISSING, BUG-WF81-DISPENSE-FLOW-MISSING, BUG-WF81-PBS-AUTHORITY-MISSING, BUG-WF81-ASLR-READONLY, BUG-ARCH-MEDICATION-STATUS-ENUM-DRIFT, BUG-344, BUG-P1 |
| RM-2026-006 | Repo declutter and project-boundary separation | cross-cutting | P1 | staged (pre+post) | proposed | Architecture + Platform | `d10` declutter plan, guard upgrades, ownership map | no tracked stale/generated artifacts in core + split-ready boundary contract | BUG-SA-103, BUG-SA-105, BUG-INFRA-ENV-CONTRACT-GAP, BUG-ARCH-ALLOWLIST-TIMEBOMB-2026-12-31, BUG-D10-GUARD-TRACKED-IGNORED, BUG-D10-GUARD-ZERO-BYTE, BUG-D10-GUARD-ENV-TEMPLATE, BUG-D10-GUARD-XPROJECT-BOUNDARY, BUG-FIX-REGISTRY-ORPHAN-DRAIN |

## 4) New Feature Intake Template

Use this table for any proposed feature before build:

| Field | Required Content |
|---|---|
| Feature name | Clear user-facing capability name |
| Why now | Clinical/business value + urgency |
| Workflow impact | Existing workflow IDs affected |
| Data scope | Patient/team/clinic/org/external |
| Access model | Role-based visibility and actions |
| Risk class | S0/S1/S2/S3 potential impact |
| Test plan | L1-L5 evidence expectations |
| Rollout plan | Feature flags, migration, backfill, rollback |

## 5) Pre-Deployment vs Post-Deployment Policy

- `pre-deployment`: mandatory for patient safety, security, integrity, or compliance blockers.
- `post-deployment`: only non-blocking hardening/optimizations with explicit guardrails.

Any deferred item must have:

1. a tracked bug,
2. a due milestone,
3. and a risk owner.

## 6) Governance Cadence

1. Weekly roadmap review (product + architecture + QA).
2. Monthly integrity audit: roadmap state must match shipped code reality.
3. No release tag without corresponding roadmap state transition to `released`.
