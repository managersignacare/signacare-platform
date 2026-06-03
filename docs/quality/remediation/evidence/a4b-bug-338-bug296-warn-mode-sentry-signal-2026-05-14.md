# A4b BUG-338 Local Evidence — BUG-296 WARN-Mode Sentry Signal

**Date:** 2026-05-14  
**Lane:** A4b (Security / Privacy / Observability)  
**BUG:** `BUG-338`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Added `apps/api/src/shared/prescriberHpiiWarnSignal.ts`:
   - warning-level Sentry signal for BUG-296 WARN-mode HPI-I degradations,
   - stable tags/fingerprint for deterministic alert routing,
   - bounded in-process throttle (15-minute window per clinic+staff+shape).
2. Wired `requireValidHpii` WARN branch in `shared/authGuards.ts`:
   - existing BUG-296 WARN log behavior preserved,
   - signal emission added via `emitPrescriberHpiiWarnModeSignal(...)`.
3. Failure behavior:
   - signal capture failures are fail-open (no clinical-flow disruption),
   - structured WARN emitted for signal-capture failure diagnostics.

## Regression Proof (Local)

1. `npm run test -w apps/api -- tests/unit/prescriberHpiiWarnSignal.test.ts` => PASS (`4/4`)
   - no-DSN skip
   - DSN-enabled emit
   - duplicate-throttle within window
   - re-emit after window
2. `npm run test:integration -w apps/api -- tests/integration/hpiiValidation.int.test.ts` => PASS (`12/12`)
3. `npm run lint:changed` => PASS
4. `npm run typecheck` => PASS
5. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Canary validates Sentry routing rule for BUG-338 fingerprint/tags.
2. Burn-in and post-burn-in verification completed per lane closure contract.
3. Catalogue row flips only after rollout evidence packet is attached.
