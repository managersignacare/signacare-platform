# B3 — BUG-567 Optimistic-Lock Conflict Detail Redaction (2026-05-14)

## Scope

- Lane: `B1/B2/B3` (shared optimistic-lock helper used by command surfaces)
- Bug: `BUG-567`
- Objective: remove tenant-scope leakage (`clinic_id`) from client-facing `OPTIMISTIC_LOCK_CONFLICT` details while preserving deterministic retry/debug signal.

## Structural Changes

1. Centralized client payload redaction in shared helper:
   - `apps/api/src/shared/db/optimisticLock.ts`
   - Added `redactOptimisticLockWhereForClient(where)` (returns `{ id }` only).
   - Added `buildOptimisticLockConflictDetails(...)`:
     - `table`
     - redacted `where`
     - `expectedLockVersion`
     - `scope: 'clinic_scoped'`
2. Routed all helper conflict throws through the new builder:
   - `updateWithOptimisticLock(...)` now throws `AppError(409, OPTIMISTIC_LOCK_CONFLICT_CODE, buildOptimisticLockConflictDetails(...))`.

## Why This Is Architectural

- The fix is at the shared helper boundary, not per-route patching.
- All current optimistic-lock consumers inherit the same response contract automatically:
  - prescriptions
  - patient_medications
  - episodes (helper path)
  - treatment_pathways
  - advance_directives
  - legal_orders
  - escalations
  - any future helper consumer

## Regression Proof

- Unit: `apps/api/tests/unit/optimisticLock.test.ts`
  - `OL-VAL-10` pins redaction behavior (`clinic_id` removed, `id` retained, `scope` set).
- Integration: `apps/api/tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts`
  - `TP-OL-1` now asserts conflict payload includes `details.where.id` and excludes `details.where.clinic_id`.

## Verification (2026-05-14)

- `npm run test -w apps/api -- tests/unit/optimisticLock.test.ts` => PASS (`10/10`)
- `npm run test:integration -w apps/api -- tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts` => PASS (`7/7`)

## Closure Posture

Local implementation is complete. Bug remains open until rollout closure contract is satisfied:

- canary verification,
- burn-in window,
- post-burn-in evidence replay and catalogue flip.
