# A3 BUG-P6 — Prescription Audit 10-Field Extension Evidence (2026-05-15)

## Scope

Close local implementation work for `BUG-P6` by extending eRx/prescription audit payloads with regulated discrete fields (including GUID, NPDS acknowledgement timestamp, timezone) and ensuring amend/cease/cancel operation families emit the extended audit contract.

## Implementation Summary

1. Added canonical eRx audit extension builder in [apps/api/src/integrations/escript/escriptService.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/integrations/escript/escriptService.ts):
   - `buildErxAuditExtension(...)` now emits a normalized regulatory payload:
     - `operation`
     - `outcome`
     - `guid`
     - `scid`
     - `npdsReference`
     - `npdsAcknowledgedAt`
     - `erxToken`
     - `pathway`
     - `timezone`
     - `auditedAt`
     - `auditSpec`
2. Wired extension across eRx operation audits:
   - submit (`submitPrescription`)
   - cancel (`cancelToken`)
   - amend (`amendPrescription`)
   - cease (`ceasePrescription`)
   - reactivate (`reactivatePrescription`)
   - reissue token (`reissueToken`)
3. Extended prescription-layer eRx submit/cancel audit in [apps/api/src/features/prescriptions/prescriptionService.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/prescriptions/prescriptionService.ts):
   - eRx submit audit now includes discrete `guid`, `npdsReference`, `npdsAcknowledgedAt`, and `timezone`.
   - cancellation audit now includes explicit regulated operation metadata (`operation`, `guid`, `timezone`, `auditSpec`).
4. Added regression proof:
   - new unit suite [apps/api/tests/unit/bugP6ErxAuditExtension.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/unit/bugP6ErxAuditExtension.test.ts) validates regulated extension presence on amend/cease/cancel surfaces.
   - updated integration suite [apps/api/tests/integration/prescriptionCancelWithReason.int.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/integration/prescriptionCancelWithReason.int.test.ts) asserts cancellation audit carries regulated extension fields.

## Verification Commands

1. `npm run test -w apps/api -- tests/unit/bugP6ErxAuditExtension.test.ts`
2. `npm run test:integration -w apps/api -- tests/integration/prescriptionCancelWithReason.int.test.ts`
3. `npm run lint:changed`
4. `npm run typecheck`
5. `npm run guard:claude-discipline:ci`

## Verification Results

- `npm run test -w apps/api -- tests/unit/bugP6ErxAuditExtension.test.ts` => PASS (`3/3`)
- `npm run test:integration -w apps/api -- tests/integration/prescriptionCancelWithReason.int.test.ts` => PASS (`9/9`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## BUG Ledger State

- `BUG-P6`: local implementation + regression proof landed.
- Final closure still requires canary/burn-in/post-burn-in rollout evidence per program closure contract.
