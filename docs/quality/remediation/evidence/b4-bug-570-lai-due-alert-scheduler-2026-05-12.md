# B4 BUG-570 — LAI Due-Alert Scheduler Evidence (2026-05-12)

## Scope

Close `BUG-570` by replacing the LAI scheduler stub with a production scheduler using canonical B4 reliability controls.

## Implementation Summary

1. Replaced `apps/api/src/jobs/schedulers/laiAlertScheduler.ts` stub with:
   - bucketed reminder processor (`T-7d`, `T-3d`, `T-1d`, `T+overdue`)
   - deterministic dedupe keys
   - inactive-recipient filtering + clinic-admin fallback
   - immutable audit rows for reassignment/no-recipient paths
   - live-context query from `lai_schedules.next_due_date` (schema-authoritative)
2. Added scheduler bootstrap documentation note in [apps/api/src/jobs/bootstrap.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/jobs/bootstrap.ts).
3. Added dedicated audit actions:
   - `LAI_DUE_RECIPIENT_REASSIGNED`
   - `LAI_DUE_NO_RECIPIENT_AVAILABLE`
4. Added tests:
   - [apps/api/tests/unit/laiAlertScheduler.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/unit/laiAlertScheduler.test.ts)
   - [apps/api/tests/integration/laiAlertScheduler.int.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/integration/laiAlertScheduler.int.test.ts)

## Verification Commands

1. `npm run lint:changed`
2. `npm run typecheck`
3. `npm run guard:claude-discipline:ci`
4. `npx vitest run apps/api/tests/unit/laiAlertScheduler.test.ts`
5. `npx vitest run --config vitest.integration.config.ts apps/api/tests/integration/laiAlertScheduler.int.test.ts`

## Verification Results

- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `cd apps/api && npx vitest run tests/unit/laiAlertScheduler.test.ts` => PASS (`12/12`)
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/laiAlertScheduler.int.test.ts` => PASS (`5/5`)

## BUG Ledger State

- `BUG-570`: implementation landed in-repo; rollout closure (canary + burn-in + post-burn-in verification) remains required before final close.
