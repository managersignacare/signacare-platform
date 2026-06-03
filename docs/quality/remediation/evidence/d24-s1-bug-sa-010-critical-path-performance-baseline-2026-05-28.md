# D24 S1 Closure — BUG-SA-010 Critical Path Performance Baseline

**Date:** 2026-05-28  
**Bug:** `BUG-SA-010`  
**Scope:** Pre-deployment baseline and regression guard for high-risk dashboard/allocation read paths.

## What Changed

1. Added dedicated integration baseline suite:
   - `apps/api/tests/integration/bugSa010CriticalPathPerformance.int.test.ts`
   - Covers:
     - `GET /api/v1/dashboard/clinician`
     - `GET /api/v1/dashboard/team/scopes`
     - `GET /api/v1/staff-settings/transitions`
     - `GET /api/v1/reallocations/pending`
   - Each endpoint runs warm-up + repeated samples and computes p95 latency.

2. Added explicit measured telemetry output from the test:
   - Suite now logs a structured p95 snapshot (`BUG-SA-010 baseline p95 (ms)`) so closure evidence records real measured values, not only assertion pass/fail.

3. Added bounded p95 regression gates:
   - dashboard paths: `< 1200 ms`
   - transitions/reallocations paths: `< 1400 ms`
   - Any future N+1/aggregation blowup on these critical paths fails the suite.

4. Added fix-registry anchor:
   - `R-FIX-BUG-SA-010-CRITICAL-PATH-BASELINE`

## Gate Evidence (local)

- `cd apps/api && npx tsc --noEmit` ✅
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/bugSa010CriticalPathPerformance.int.test.ts` ✅
- `bash .github/scripts/check-fix-registry.sh` ✅
- `npm run -s guard:bugs-remaining-uniqueness` ✅
- `npm run -s guard:claude-discipline:ci` ✅

## Closure Note

`BUG-SA-010` is closed at the code/test baseline layer: critical read paths now have
explicit, enforced latency envelopes and regression protection. Staging/prod
burn-in telemetry remains part of ongoing operational readiness, but local
pre-deploy baseline coverage is now in place and fail-loud.
