# A4c BUG-308 Local Evidence — Shutdown Observability Dashboard

**Date:** 2026-05-14  
**Lane:** A4c (Platform Hygiene + LLM Runtime Governance)  
**BUG:** `BUG-308`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Canonical shutdown runtime now emits structured per-run telemetry in `apps/api/src/shared/gracefulShutdown.ts`:
   - per-hook duration, timeout, priority, and outcome (`completed` / `failed` / `timed_out` / `skipped_budget`),
   - run-level summary counters + budget exhaustion signal,
   - bounded in-memory history (last 50 runs),
   - rolling 24-hour aggregate snapshot API via `getGracefulShutdownObservabilitySnapshot()`.
2. Compliance-reporting surface now includes shutdown reliability metrics:
   - `GET /api/v1/reports/compliance/summary` includes `platformReliability` rollups,
   - new endpoint `GET /api/v1/reports/compliance/shutdown-observability` returns typed per-hook metrics payload (Zod fail-closed parse).
3. Dashboard UI now renders shutdown observability:
   - new Platform Reliability section in `apps/web/src/features/reports/pages/ComplianceDashboardPage.tsx`,
   - cards for run/timeouts/failures/duration metrics,
   - per-hook metrics table (invocations, timed-out/failed counts, avg/max duration, max timeout).

## Regression Proof (Local)

1. `npm run test -w apps/api -- tests/unit/gracefulShutdownObservability.test.ts` => PASS (`2/2`)
2. `npm run test:integration -w apps/api -- tests/integration/reportsRoutesHealth.int.test.ts` => PASS (`6/6`)
3. `npm run test:integration -w apps/api -- tests/integration/gracefulShutdown.int.test.ts` => PASS (`11/11`)
4. `npm run lint:changed` => PASS
5. `npm run typecheck` => PASS
6. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Canary shutdown drill to capture real hook telemetry under runtime load.
2. Burn-in + post-burn-in evidence packet with dashboard snapshots and hook-timeout/failure trend verification.
3. Catalogue row flip only after rollout closure contract is satisfied.
