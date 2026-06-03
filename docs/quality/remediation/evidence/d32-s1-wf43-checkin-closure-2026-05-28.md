# D32 — S1 Closure: BUG-WF43 Check-In Pair

**Date:** 2026-05-28  
**Bugs:**  
- `BUG-WF43-CHECK-IN-COLUMN-MISSING`  
- `BUG-WF43-ITEMS-AGGREGATION-MISSING`  
**Severity:** S1

## What Was Completed

1. Verified check-in persistence + aggregation behavior through dedicated integration suite:
   - `apps/api/tests/integration/bugWf43CheckInPersistence.int.test.ts`
2. Fixed a real API contract defect discovered during closure run:
   - `GET /appointments/:id/check-in-outstanding` returned `Date` for `checkInAt` while response contract required `string | null`.
   - Added `toNullableIsoString()` conversion in `apps/api/src/features/roles/receptionistFeatureRoutes.ts` before schema parse.
3. Re-ran integration suite after patch; all tests green.

## Gate Evidence

- `cd apps/api && npm run test:integration -- bugWf43CheckInPersistence.int.test.ts` -> **PASS** (3 tests)
  - Persists `check_in_at` + `checked_in_by_id`
  - Handles not-found path correctly
  - Returns outstanding counts payload with valid response shape

## Outcome

Both WF43 S1 check-in bugs are closed with endpoint-level integration proof and a concrete contract-shape fix that prevents false 422 failures on check-in outstanding reads.

