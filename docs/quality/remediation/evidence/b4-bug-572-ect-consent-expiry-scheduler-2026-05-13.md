# B4 BUG-572 — ECT Consent-Expiry Scheduler Evidence (2026-05-13)

## Scope

Close `BUG-572` by replacing the ECT consent-expiry gap with a production scheduler using canonical B4 reliability controls.

## Implementation Summary

1. Added [apps/api/src/jobs/schedulers/ectConsentExpiryScheduler.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/jobs/schedulers/ectConsentExpiryScheduler.ts) with:
   - derived expiry model (`consent_date + ect_consent_validity_days`)
   - deterministic buckets (`T-7d`, `T+overdue`)
   - deterministic dedupe keys including expiry date and UTC fired-day
   - inactive-recipient filtering + clinic-admin fallback
   - immutable audit rows for reassignment/no-recipient paths
   - live-context query from `ect_courses` schema-truth fields
2. Registered scheduler in [apps/api/src/jobs/bootstrap.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/jobs/bootstrap.ts).
3. Added default threshold contract in [apps/api/src/features/settings/settingsService.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/settings/settingsService.ts):
   - `ect_consent_validity_days: 180`
4. Added audit action literals in [apps/api/src/utils/audit.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/utils/audit.ts):
   - `ECT_CONSENT_RECIPIENT_REASSIGNED`
   - `ECT_CONSENT_NO_RECIPIENT_AVAILABLE`
5. Added tests:
   - [apps/api/tests/unit/ectConsentExpiryScheduler.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/unit/ectConsentExpiryScheduler.test.ts)
   - [apps/api/tests/integration/ectConsentExpiryScheduler.int.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/integration/ectConsentExpiryScheduler.int.test.ts)

## Verification Commands

1. `npm run lint:changed`
2. `npm run typecheck`
3. `npm run guard:claude-discipline:ci`
4. `cd apps/api && npx vitest run tests/unit/ectConsentExpiryScheduler.test.ts`
5. `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/ectConsentExpiryScheduler.int.test.ts`

## Verification Results

- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `cd apps/api && npx vitest run tests/unit/ectConsentExpiryScheduler.test.ts` => PASS (`12/12`)
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/ectConsentExpiryScheduler.int.test.ts` => PASS (`5/5`)

## BUG Ledger State

- `BUG-572`: implementation landed in-repo; rollout closure (canary + burn-in + post-burn-in verification) remains required before final close.
