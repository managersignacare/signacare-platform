# B4 — BUG-569-FOLLOWUP-ORPHAN-PRESCRIBER-FALLBACK Evidence (2026-05-13)

## Scope
- BUG: `BUG-569-FOLLOWUP-ORPHAN-PRESCRIBER-FALLBACK`
- Lane: `B4 — Scheduler + Alert Reliability`
- Objective: remove silent orphan-registration state for active clozapine patients whose registered prescriber was nulled.

## Structural Changes
- Updated scheduler:
  - `apps/api/src/jobs/schedulers/clozapineAlertScheduler.ts`
- Added orphan alert class:
  - `listOrphanedPrescriber()` selects active (`ceased_date IS NULL`, `deleted_at IS NULL`) registrations with `prescriber_staff_id IS NULL`.
  - recipient candidates built from:
    - current episode `primary_clinician_id`
    - clinic `nominated_admin_staff_id`
    - clinic `delegated_admin_staff_id`
  - candidate recipients are filtered to active staff (`is_active=true`, `deleted_at IS NULL`) before emit.
- Added dedicated dedupe namespace:
  - `dedupeKeyForClozapineOrphanPrescriber(...)`
  - key shape: `clozapine-orphan-prescriber:<registration_id>:<staff_id>:fired-day:<UTC-day>`
- Added fail-visible safety logging:
  - `CLOZAPINE_ORPHAN_PRESCRIBER_NO_RECIPIENT_CONFIGURED`
  - `CLOZAPINE_ORPHAN_PRESCRIBER_NO_ACTIVE_RECIPIENT`
- Emit contract:
  - critical category `clozapine`
  - title `Clozapine registration missing prescriber`
  - payload includes `alert_kind='orphan_prescriber_registration'`

## Regression Tests Updated
- Unit:
  - `apps/api/tests/unit/clozapineAlertScheduler.test.ts`
  - Added:
    - `TP-CL-2c` orphan dedupe-key shape
    - `TP-CL-4j` orphan row emits to active primary + admin
    - `TP-CL-4k` no-active-recipient path is fail-visible and emits none
- Integration:
  - `apps/api/tests/integration/clozapineAlertSchedulerCycle2.int.test.ts`
  - `TP-CL-INT-569-5` now asserts orphan alerts route to primary clinician + governance admin

## Verification Executed
- `npm run test -w apps/api -- tests/unit/clozapineAlertScheduler.test.ts` => PASS (19/19)
- `npm run test:integration -w apps/api -- clozapineAlertSchedulerCycle2.int.test.ts` => PASS (6/6)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## Status
- Implementation landed (local lane work complete).
- Rollout closure pending canary + burn-in + post-burn-in verification.
