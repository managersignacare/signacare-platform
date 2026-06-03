# B4 — BUG-451 Follow-up: Migrate Legacy Pathology Integration Test (2026-05-14)

## Scope

- Bug: `BUG-451-FOLLOWUP-MIGRATE-OLDER-PATHOLOGY-INT-TEST`
- Surface: `apps/api/tests/integration/pathologyCriticalAlerts.int.test.ts`
- Goal: remove test-side parallel SQL context clone and run against production scheduler live context.

## Change Summary

1. Removed in-file helper `buildLiveCtx()` that re-implemented:
   - `listUnacknowledgedCritical` SQL
   - scheduler emit wiring and threshold wrapper
2. Switched all test invocations to:
   - `processPathologyCriticalAlerts(now, await buildLiveContext())`
3. Preserved deterministic fixture-level assertions by keying checks to seeded `resultId` notification rows:
   - especially in TP-PA-INT-4 (soft-deleted order exclusion), now using before/after count delta for this seeded result.

## Why This Is Structural

- Eliminates production/test SQL drift class.
- Keeps one authoritative query path (scheduler `buildLiveContext`) for behavior under test.
- Retains deterministic assertions without introducing new test-only query wrappers.

## Verification

- `npm run test:integration -w apps/api -- tests/integration/pathologyCriticalAlerts.int.test.ts` => PASS (`4/4`)

## Closure Posture

- Local follow-up is complete.
- Catalogue row can be marked fixed immediately (test-harness follow-up; no rollout burn-in dependency).
