# B4 Evidence — BUG-579 Pathology Current-Episode Fallback (2026-05-13)

## Scope

Close BUG-579 in scheduler path by preventing recipient-loss when
`pathology_orders.episode_id` points to a soft-deleted episode after team
handover.

## Structural Changes

1. Updated `apps/api/src/jobs/schedulers/pathologyCriticalScheduler.ts`:
   - Replaced direct `episodes` dependency with:
     - active original-episode join (`ep.deleted_at IS NULL` in JOIN),
     - `LEFT JOIN LATERAL` current open-episode lookup (`status='open'`,
       `deleted_at IS NULL`, latest `start_date`).
   - Resolved recipient candidate as:
     - `COALESCE(ep.primary_clinician_id, cur_ep.primary_clinician_id)`.
   - Removed row-elimination behavior that previously occurred when original
     episode was soft-deleted.

2. Added live integration proof in
   `apps/api/tests/integration/pathologyCriticalAlertsCycle2.int.test.ts`:
   - `TP-PA-INT-579-1` asserts:
     - original episode soft-deleted,
     - orderer inactive,
     - no admin fallback configured,
     - scheduler emits tier-1 to current open-episode primary clinician,
     - no `critical_no_recipient_available` / reassignment audit row.

## Verification

1. `npm run test:integration -w apps/api -- pathologyCriticalAlertsCycle2.int.test.ts` => PASS (9/9)
2. `npm run test -w apps/api -- pathologyCriticalScheduler.test.ts` => PASS (39/39)
3. `npm run lint:changed` => PASS
4. `npm run typecheck` => PASS
5. `npm run guard:claude-discipline:ci` => PASS

## Notes

- BUG-579 is implementation-complete in-repo.
- Catalogue remains open until rollout closure contract completes
  (canary + burn-in + post-burn-in verification evidence).
