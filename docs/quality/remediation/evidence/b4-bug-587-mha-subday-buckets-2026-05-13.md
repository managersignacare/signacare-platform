# B4 BUG-587 — MHA Narrow-Window Sub-Day Buckets Evidence (2026-05-13)

## Scope

Close the implementation slice for `BUG-587` by adding sub-day urgency buckets for narrow-window statutory MHA orders.

## Implementation Summary

1. Updated legal-order scheduler repository row contract in [apps/api/src/features/legal/legalOrderRepository.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/legal/legalOrderRepository.ts):
   - joined `legal_order_types` for both canonical (`legal_orders`) and legacy (`patient_legal_orders`) paths
   - projected `order_type_max_duration_days` into scheduler rows
2. Updated scheduler bucket logic in [apps/api/src/jobs/schedulers/mhaReviewScheduler.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/jobs/schedulers/mhaReviewScheduler.ts):
   - kept baseline day buckets intact
   - added `T-12h` and `T-4h` for orders where `max_duration_days <= 7` on due day
   - retained critical severity/escalation behavior for new sub-day buckets
3. Added proof coverage:
   - unit coverage in [apps/api/tests/unit/mhaReviewScheduler.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/unit/mhaReviewScheduler.test.ts) for `T-12h`, `T-4h`, and non-narrow control
   - live integration coverage in [apps/api/tests/integration/mhaReviewSchedulerCycle2.int.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/integration/mhaReviewSchedulerCycle2.int.test.ts) verifying narrow-window order emits `T-12h` on production path

## Verification Commands

1. `cd apps/api && npx vitest run tests/unit/mhaReviewScheduler.test.ts`
2. `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/mhaReviewSchedulerCycle2.int.test.ts`
3. `npm run lint:changed`
4. `npm run typecheck`
5. `npm run guard:claude-discipline:ci`

## Verification Results

- `cd apps/api && npx vitest run tests/unit/mhaReviewScheduler.test.ts` => PASS (`49/49`)
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/mhaReviewSchedulerCycle2.int.test.ts` => PASS (`10/10`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## BUG Ledger State

- `BUG-587`: implementation landed in-repo; rollout closure (canary + burn-in + post-burn-in verification) remains required before final close.
