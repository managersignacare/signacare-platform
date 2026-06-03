# A3 BUG-P7 — Prescription Cancel Dispense/Lock Guard Evidence (2026-05-15)

## Scope

Close the local implementation gap for `BUG-P7` by fail-closing prescription cancellation when the eScript lifecycle has already progressed to a non-cancellable state (dispensed or locked-for-amend).

## Implementation Summary

1. Added canonical cancellation-blocking token query in [apps/api/src/features/prescriptions/prescriptionRepository.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/prescriptions/prescriptionRepository.ts):
   - `findCancellationBlockedErxTokenForPrescription(...)`
   - blocks on `erx_tokens.status in ('dispensed', 'locked')` or `dispensed_at IS NOT NULL`
   - deterministic precedence: `locked` → `dispensed` → `dispensed_at` evidence.
2. Added fail-closed service guard in [apps/api/src/features/prescriptions/prescriptionService.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/prescriptions/prescriptionService.ts):
   - pre-cancel block on `prescriptions.status === 'dispensed'` (`ERX_CANCEL_BLOCKED_DISPENSED`)
   - pre-cancel block on blocking token lifecycle:
     - `locked` => `ERX_CANCEL_BLOCKED_LOCKED`
     - `dispensed` / `dispensed_at` => `ERX_CANCEL_BLOCKED_DISPENSED`
   - guard executes before local cancel mutation to prevent lifecycle lie-about-success.
3. Extended regression proof in [apps/api/tests/integration/prescriptionCancelWithReason.int.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/integration/prescriptionCancelWithReason.int.test.ts):
   - `T10`: cancellation rejected when token is dispensed.
   - `T11`: cancellation rejected when token is locked-for-amend.

## Verification Commands

1. `npm run test:integration -w apps/api -- tests/integration/prescriptionCancelWithReason.int.test.ts`
2. `npm run lint:changed`
3. `npm run typecheck`
4. `npm run guard:claude-discipline:ci`

## Verification Results

- `npm run test:integration -w apps/api -- tests/integration/prescriptionCancelWithReason.int.test.ts` => PASS (`9/9` tests, including T10/T11 scenarios)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## BUG Ledger State

- `BUG-P7`: local implementation + regression coverage landed.
- Final closure still requires canary/burn-in/post-burn-in rollout evidence per program closure contract.
