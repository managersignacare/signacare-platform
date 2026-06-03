# D12 M1 Scheduler Emitter Convergence (2026-05-23)

**Date:** 2026-05-23  
**Wave:** M1 structural remediation continuation  
**Scope:** Replace scheduler-direct notification emits with centralized emitter path and enforce via guard.

## Changes Landed

1. Scheduler notification emits now route through centralized adapter:
   - `apps/api/src/jobs/schedulers/schedulerSignalEmitter.ts` (`emitSchedulerSignal`)
   - Updated schedulers:
     - `advanceDirectiveReviewScheduler.ts`
     - `clozapineAlertScheduler.ts`
     - `clozapineMonitoringWeekScheduler.ts`
     - `ectConsentExpiryScheduler.ts`
     - `laiAlertScheduler.ts`
     - `mhaReviewScheduler.ts`
     - `pathologyCriticalScheduler.ts`
     - `prescriptionRepeatScheduler.ts`
     - `referralSlaScheduler.ts`
     - `suicidalIdeationAfterHoursScheduler.ts`
     - `therapeuticLevelMonitoringScheduler.ts`

2. M1 regression guard hardened:
   - `scripts/guards/check-centralized-notification-emitter.ts`
   - Scope expanded to scan all `apps/api/src/**/*.ts`
   - Pure comment-line false positives filtered
   - Still fail-closed on real direct `notificationService.emit(...)` usage outside allowed centralized paths.

## Verification Executed

### Guard checks
- `npm run -s guard:centralized-notification-emitter` ✅
- `npm run -s guard:no-fire-and-forget` ✅
- `npm run -s guard:dashboard-no-fail-open-catch` ✅
- `npm run -s guard:claude-discipline:ci` ✅

### Typecheck
- `cd apps/api && npx tsc --noEmit` ✅

### Targeted tests
- `npx vitest run scripts/guards/__tests__/check-centralized-notification-emitter.test.ts` ✅
- `cd apps/api && npx vitest run --config vitest.config.ts` on scheduler-focused unit pack (11 files + referral scheduler scope assertion) ✅ (`244/244` passing)

## Outcome

M1 is now materially tighter: scheduler fan-out no longer bypasses centralized signal envelope, and repo guard coverage prevents regression to direct emit calls in any API source path.
