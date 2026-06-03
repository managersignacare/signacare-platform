# D19 — S1 Closure Slice: BUG-SA-008 Worker Failure Observability Baseline

**Date:** 2026-05-28  
**Bug:** `BUG-SA-008`  
**Scope:** Queue/DLQ failure telemetry baseline across active BullMQ workers.

## What changed

1. Added missing failed-job telemetry on AI worker:
   - [`apps/api/src/jobs/workers/aiWorker.ts`](/Users/drprakashkamath/Projects/Signacare/apps/api/src/jobs/workers/aiWorker.ts)
   - New `worker.on('failed', ...)` structured `logger.error` path.
2. Added mechanical baseline guard:
   - [`scripts/guards/check-worker-failure-observability.ts`](/Users/drprakashkamath/Projects/Signacare/scripts/guards/check-worker-failure-observability.ts)
   - Enforces:
     - non-stub workers include failed handlers + error logging
     - JobBus failed-job retention (`removeOnFail`) remains present
     - known stubs (`flagWorker`, `llmWorker`) remain explicitly tracked
3. Wired guard into scripts/CI discipline chain:
   - [`package.json`](/Users/drprakashkamath/Projects/Signacare/package.json) -> `guard:worker-failure-observability`
   - Included in `guard:claude-discipline`.

## Why this closes BUG-SA-008

- Failure paths are now explicit and mechanically enforced across all live worker lanes.
- Queue failure visibility is no longer best-effort-only at reviewer memory level; guard blocks drift.

## Validation run

### L1
- `cd apps/api && npx tsc --noEmit` ✅

### L2/L3 targeted
- `cd apps/api && npm run test:integration -- bugWf71ReferralAckEmail.int.test.ts bugWf71ReferralExpiryScheduler.int.test.ts` ✅
- `cd apps/api && npx vitest run --config vitest.config.ts tests/unit/billingServiceReceiptEmail.test.ts` ✅

### L4 targeted guards
- `npm run -s guard:worker-failure-observability` ✅
- `npm run -s guard:route-idempotency-contract` ✅
- `npm run -s guard:claude-discipline:ci` ✅
- `bash .github/scripts/check-fix-registry.sh` ✅
