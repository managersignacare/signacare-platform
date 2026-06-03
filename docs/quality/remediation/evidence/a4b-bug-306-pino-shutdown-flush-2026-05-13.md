# A4b BUG-306 Local Evidence — Pino Sync Flush In Shutdown

**Date:** 2026-05-13  
**Lane:** A4b (Security / Privacy / Observability)  
**BUG:** `BUG-306`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. `apps/api/src/utils/logger.ts`
   - logger now owns an explicit destination handle: `pino.destination({ sync: false })`
   - exported `flushLoggerSync()` helper executes `destination.flushSync()` when available
2. `apps/api/src/server.ts`
   - added shutdown hook `pino-sync-flush` at priority `5` in canonical graceful-shutdown registry
   - hook fail-path is fail-visible via console warning/error
3. `apps/api/src/shared/gracefulShutdown.ts`
   - priority-bucket docs updated to include pino sync flush at `5`
4. Regression coverage:
   - `apps/api/tests/unit/pinoFlushSync.test.ts` (3 tests)
   - `apps/api/tests/integration/gracefulShutdown.int.test.ts` expanded to 11 tests with T11 same-priority ordering pin (`otel` before `pino`)
5. Fix registry pin:
   - `R-FIX-PINO-SYNC-FLUSH` in `docs/quality/fix-registry.md`

## Local Verification

1. `npm run test -w apps/api -- tests/unit/pinoFlushSync.test.ts` => PASS (`3/3`)
2. `npm run test:integration -w apps/api -- gracefulShutdown.int.test.ts` => PASS (`11/11`)
3. `npm run lint:changed` => PASS
4. `npm run typecheck` => PASS
5. `npm run guard:claude-discipline:ci` => PASS

## Post-Deploy Closure Items (Still Required)

1. Canary-run shutdown drill captures final shutdown logs and confirms no end-of-shutdown log loss.
2. Burn-in and post-burn-in verification completed per lane closure contract.
3. Catalogue row flips to `fixed` only after rollout evidence + signoff packet.

