# B4 BUG-588 — MHA Missing `review_date` Data-Quality Evidence (2026-05-13)

## Scope

Close the implementation slice for `BUG-588` by adding a fail-visible data-quality path for active legal orders missing `review_date`, so they no longer disappear silently from MHA reminder scheduling.

## Implementation Summary

1. Added missing-review-date repository projection in [apps/api/src/features/legal/legalOrderRepository.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/legal/legalOrderRepository.ts):
   - `listActiveOrdersMissingReviewDate(conn)`
   - covers both `legal_orders` and `patient_legal_orders`
2. Extended [apps/api/src/jobs/schedulers/mhaReviewScheduler.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/jobs/schedulers/mhaReviewScheduler.ts) with BUG-588 data-quality flow:
   - `dedupeKeyForMhaMissingReviewDate(...)`
   - `emitMissingReviewDateAlerts(...)`
   - bell-only daily dedupe for admin notifications
   - structured WARN evidence on first daily emit
3. Added clinic-admin recipient resolution in live context:
   - nominated/delegated admin selection
   - active + non-deleted staff enforcement
4. Added deterministic test coverage:
   - unit: [apps/api/tests/unit/mhaReviewScheduler.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/unit/mhaReviewScheduler.test.ts)
   - integration: [apps/api/tests/integration/mhaReviewSchedulerCycle2.int.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/integration/mhaReviewSchedulerCycle2.int.test.ts)

## Verification Commands

1. `cd apps/api && npx vitest run tests/unit/mhaReviewScheduler.test.ts`
2. `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/mhaReviewSchedulerCycle2.int.test.ts`
3. `npm run lint:changed`
4. `npm run typecheck`
5. `npm run guard:claude-discipline:ci`

## Verification Results

- `cd apps/api && npx vitest run tests/unit/mhaReviewScheduler.test.ts` => PASS (`45/45`)
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/mhaReviewSchedulerCycle2.int.test.ts` => PASS (`8/8`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## BUG Ledger State

- `BUG-588`: implementation landed in-repo; rollout closure (canary + burn-in + post-burn-in verification) remains required before final close.
