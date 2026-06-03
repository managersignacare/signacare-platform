# D23 S1 Closure — BUG-ARCH-SILENT-MOCK-SUCCESS

**Date:** 2026-05-28  
**Bug:** `BUG-ARCH-SILENT-MOCK-SUCCESS`  
**Scope:** Integration fail-visible contract (ACS + FCM) when runtime config is absent.

## What Changed

1. Removed fake-success behavior from ACS unconfigured path:
   - `apps/api/src/integrations/acs/acsClient.ts`
   - When ACS env vars are missing (non-production), `sendSms(...)` now returns `success=false` with explicit `ACS_NOT_CONFIGURED` message.
   - Production path remains fail-closed (`AppError` code `ACS_NOT_CONFIGURED`).

2. Removed fake-success behavior from FCM unconfigured path:
   - `apps/api/src/integrations/fcm/fcmClient.ts`
   - When `FCM_SERVICE_ACCOUNT_PATH` is missing (non-production), `sendToTokens(...)` now returns `successCount=0`, `failureCount=tokens.length`, and explicit `FCM_NOT_CONFIGURED` message.
   - Production path remains fail-closed (`AppError` code `FCM_NOT_CONFIGURED`).

3. Added explicit failure telemetry at service layer:
   - `apps/api/src/integrations/fcm/fcmService.ts`
   - `sendToStaff(...)` and `sendToPatient(...)` now log warning-level failure metadata when provider dispatch fails or returns an error payload.

4. Added regression coverage for unconfigured integration behavior:
   - `apps/api/tests/unit/integrationMockFailVisible.test.ts`
   - Coverage:
     - non-production FCM unconfigured => failure summary (no fake success)
     - non-production ACS unconfigured => failure summary (no fake success)
     - production FCM unconfigured => throws `FCM_NOT_CONFIGURED`
     - production ACS unconfigured => throws `ACS_NOT_CONFIGURED`

5. Added fix-registry anchors:
   - `R-FIX-BUG-ARCH-SILENT-MOCK-SUCCESS-ACS`
   - `R-FIX-BUG-ARCH-SILENT-MOCK-SUCCESS-FCM`
   - `R-FIX-BUG-ARCH-SILENT-MOCK-SUCCESS-FCM-ABSENT`

## Gate Evidence (local)

- `cd apps/api && npx tsc --noEmit` ✅
- `cd apps/api && npx vitest run --config vitest.config.ts tests/unit/integrationMockFailVisible.test.ts tests/integration/productionIntegrationConfig.int.test.ts` ✅
- `bash .github/scripts/check-fix-registry.sh` ✅
- `npm run -s guard:bugs-remaining-uniqueness` ✅
- `npm run -s guard:claude-discipline:ci` ✅

## Closure Note

This closure eliminates the architecture-level false-positive delivery pattern for
core messaging integrations: unconfigured ACS/FCM no longer report success in
non-production runtime paths. Missing configuration is now fail-visible and
auditable.
