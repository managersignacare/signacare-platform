# D22 S1 Closure — BUG-WF81-DISPENSE-FLOW-MISSING

**Date:** 2026-05-28  
**Bug:** `BUG-WF81-DISPENSE-FLOW-MISSING`  
**Scope:** ePrescription dispense callback + downstream state transition pipeline

## What Changed

1. Added canonical token-resolution path for inbound ERX005 notifications:
   - `findTokenForDispenseNotification(clinicId, scriptNumber, prescriptionId?)`
   - Matching precedence: `prescription_id` -> `dsp_id` -> `token_value` -> `npds_reference`
   - File: `apps/api/src/features/prescriptions/prescriptionRepository.ts`

2. Added idempotent token dispense-write operation:
   - `markErxTokenDispensed(...)`
   - Sets `status='dispensed'`, persists dispense timestamp/pharmacy metadata, and keeps replay-safe semantics.
   - File: `apps/api/src/features/prescriptions/prescriptionRepository.ts`

3. Added service orchestration for poll + apply:
   - `prescriptionService.pollAndApplyDispenseNotifications(auth)`
   - For each notification: resolve token -> write token dispense state -> transition prescription to `dispensed` -> write audit row -> emit clinical signal.
   - File: `apps/api/src/features/prescriptions/prescriptionService.ts`

4. Updated API route behavior:
   - `POST /api/v1/prescriptions/erx/poll-dispense` now returns structural counters:
     - `matched`, `updated`, `unmatched`, `alreadyDispensed`, `errors`
   - File: `apps/api/src/features/prescriptions/prescriptionController.ts`

## Regression Coverage

- Added integration suite:
  - `apps/api/tests/integration/bugWf81DispenseFlow.int.test.ts`
  - Coverage:
    - `T1` matched notification applies token + prescription dispense state
    - `T2` replay idempotency returns `alreadyDispensed` with zero new updates
    - `T3` unmatched notification increments `unmatched` without fail-open

## Gate Evidence (local)

- `cd apps/api && npx tsc --noEmit` ✅
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/bugWf81DispenseFlow.int.test.ts` ✅ (`3/3`)

## Closure Note

This closes the missing step-23–31 class for ePrescription dispense ingestion in the core application flow (notification parse existed before; downstream state transition did not).

