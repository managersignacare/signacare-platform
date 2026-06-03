# B4 BUG-586 — MHA Current-Treating-Team Fallback Evidence (2026-05-13)

## Scope

Close the implementation slice for `BUG-586` by ensuring MHA legal-order reminders still target the current treating team when `legal_orders.episode_id` points to a stale/soft-deleted episode.

## Implementation Summary

1. Updated canonical legal-order scheduler repository query in [apps/api/src/features/legal/legalOrderRepository.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/legal/legalOrderRepository.ts):
   - added `LEFT JOIN LATERAL` over patient CURRENT active episode
   - preserved original `episode_id` join path
   - switched clinician projection to:
     - `COALESCE(ep.primary_clinician_id, cur_ep.primary_clinician_id) as primary_clinician_id`
2. Added live integration proof to [apps/api/tests/integration/mhaReviewSchedulerCycle2.int.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/integration/mhaReviewSchedulerCycle2.int.test.ts):
   - stale legal-order episode pointer (soft-deleted archived episode)
   - inactive creator + no admin configured
   - scheduler still emits tier-1 alert to current open-episode primary clinician
3. Preserved BUG-584/585/588 behavior in the same scheduler path.

## Verification Commands

1. `cd apps/api && npx vitest run tests/unit/mhaReviewScheduler.test.ts`
2. `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/mhaReviewSchedulerCycle2.int.test.ts`
3. `npm run lint:changed`
4. `npm run typecheck`
5. `npm run guard:claude-discipline:ci`

## Verification Results

- `cd apps/api && npx vitest run tests/unit/mhaReviewScheduler.test.ts` => PASS (`45/45`)
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/mhaReviewSchedulerCycle2.int.test.ts` => PASS (`9/9`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## BUG Ledger State

- `BUG-586`: implementation landed in-repo; rollout closure (canary + burn-in + post-burn-in verification) remains required before final close.
