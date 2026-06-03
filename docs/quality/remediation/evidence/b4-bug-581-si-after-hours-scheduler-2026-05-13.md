# B4 — BUG-581 SI After-Hours Scheduler Evidence (2026-05-13)

## Scope
- BUG: `BUG-581`
- Lane: `B4 — Scheduler + Alert Reliability`
- Objective: detect high suicide-risk linked clinical notes authored outside shift windows and notify on-call psychiatrist with fail-visible fallback/audit.

## Structural Changes
- Added scheduler: `apps/api/src/jobs/schedulers/suicidalIdeationAfterHoursScheduler.ts`
  - 5-minute tick (`*/5 * * * *`, `Australia/Melbourne`)
  - Candidate query joins recent `clinical_notes` to latest qualifying `risk_assessments`
  - Shift-window evaluation via `clinician_availability_blocks`
  - Deterministic on-call psychiatrist selection
  - Admin fallback + immutable audit (`SI_AFTER_HOURS_RECIPIENT_REASSIGNED`)
  - No-recipient fail-visible audit (`SI_AFTER_HOURS_NO_RECIPIENT_AVAILABLE`)
- Bootstrap wiring:
  - `apps/api/src/jobs/bootstrap.ts` includes `suicidalIdeationAfterHoursScheduler`

## Test Evidence
- Unit: `apps/api/tests/unit/suicidalIdeationAfterHoursScheduler.test.ts`
  - Time-window math
  - Shift-window matching
  - Processor flow: on-shift skip, on-call emit, admin reassignment, no-recipient fail-visible, row-level error isolation
- Integration: `apps/api/tests/integration/suicidalIdeationAfterHoursScheduler.int.test.ts`
  - On-call psychiatrist emit path
  - Admin fallback path + immutable audit
  - No-recipient path + immutable audit

## Status
- Implementation landed (local lane work complete).
- Rollout closure pending canary + burn-in + post-burn-in verification.
