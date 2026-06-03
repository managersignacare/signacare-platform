# D18 — S1 Closure Slice: BUG-SA-007 Route Idempotency Contract

**Date:** 2026-05-28  
**Bug:** `BUG-SA-007`  
**Scope:** Retry-safe mutation contract for high-risk referral + billing write routes.

## What changed

1. Expanded idempotency middleware coverage on high-risk mutation routes:
   - [`apps/api/src/features/referrals/referralRoutes.ts`](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/referrals/referralRoutes.ts)
   - [`apps/api/src/features/billing/billingRoutes.ts`](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/billing/billingRoutes.ts)
2. Added a mechanical drift guard:
   - [`scripts/guards/check-route-idempotency-contract.ts`](/Users/drprakashkamath/Projects/Signacare/scripts/guards/check-route-idempotency-contract.ts)
3. Wired guard script:
   - [`package.json`](/Users/drprakashkamath/Projects/Signacare/package.json) -> `guard:route-idempotency-contract`

## Why this closes BUG-SA-007

- Multi-write mutation surfaces now consistently support deterministic request replay using the existing idempotency key middleware path.
- Guard-level enforcement prevents route-level regression (future removal of middleware on protected routes fails CI).

## Validation run

### L1
- `npx tsc --noEmit -p packages/shared/tsconfig.json` ✅
- `cd apps/api && npx tsc --noEmit` ✅

### L2 / L3 targeted
- `cd apps/api && npm run test:integration -- bugWf71ReferralAckEmail.int.test.ts bugWf71ReferralExpiryScheduler.int.test.ts` ✅
- `cd apps/api && npx vitest run --config vitest.config.ts tests/unit/billingServiceReceiptEmail.test.ts` ✅

### L4 targeted guards
- `npm run -s guard:route-idempotency-contract` ✅
- `npm run -s guard:no-fire-and-forget` ✅
- `bash .github/scripts/check-fix-registry.sh` ✅

## Risk / rollout note

- This slice is non-breaking for existing clients because `idempotencyMiddleware()` remains pass-through when `Idempotency-Key` is absent.
- Web clients already auto-inject keys on mutation calls via API client interceptor.
