# D16 — S1 Closure Slice: WF81 PBS Authority + ASLR Write Path

**Date:** 2026-05-28  
**Owner:** Platform API  
**Bugs targeted:** `BUG-WF81-PBS-AUTHORITY-MISSING`, `BUG-WF81-ASLR-READONLY`

## Scope

1. Enforce PBS authority constraints at shared-contract layer and submit boundary.
2. Add MySL write/update synchronization so medication requests are no longer read-only from Signacare prescribe/cancel flows.
3. Preserve fail-safe behavior (best-effort downstream sync does not corrupt prescribing path).

## Implementation

- Shared schema hardening:
  - [packages/shared/src/prescription.schemas.ts](../../../../packages/shared/src/prescription.schemas.ts)
  - `PrescriptionCreateSchema.superRefine(...)` now enforces:
    - authority scripts require `pbsItemCode`
    - authority scripts require `authorityCode`

- Submit boundary hardening:
  - [apps/api/src/features/prescriptions/prescriptionService.ts](../../../../apps/api/src/features/prescriptions/prescriptionService.ts)
  - Added canonical payload derivation from persisted prescription row:
    - `canonicalizeErxPayloadFromPrescription(...)`
  - Added authority consistency gate:
    - `assertPbsAuthorityConsistency(...)`
  - Submit path now parses canonical payload through `ErxSubmitContractSchema` before dispatch.

- ASLR/MySL write path:
  - [apps/api/src/integrations/escript/myslClient.ts](../../../../apps/api/src/integrations/escript/myslClient.ts)
  - Added `syncMedicationRequestFromPrescription(...)` (create/update behavior, patient+consent checks, identifier normalization, best-effort returns).
  - [apps/api/src/features/prescriptions/prescriptionService.ts](../../../../apps/api/src/features/prescriptions/prescriptionService.ts)
  - Submit success now triggers `syncMedicationRequestFromPrescription(... status: 'active' ...)`.
  - Cancel path now triggers `syncMedicationRequestFromPrescription(... status: 'cancelled' ...)`.
  - Audit rows capture sync outcome metadata (`mysl_sync`, `mysl_sync_cancel`).

## Regression coverage

- Shared contract tests:
  - [packages/shared/src/prescription.schemas.test.ts](../../../../packages/shared/src/prescription.schemas.test.ts)
  - 4/4 pass.

- MySL unit tests:
  - [apps/api/tests/unit/myslMedicationSync.test.ts](../../../../apps/api/tests/unit/myslMedicationSync.test.ts)
  - 4/4 pass.

- Integration coverage:
  - [apps/api/tests/integration/bugP5IhiStatusPrescribeGate.int.test.ts](../../../../apps/api/tests/integration/bugP5IhiStatusPrescribeGate.int.test.ts)
  - Extended with WF81 assertions:
    - authority-field derivation (`T4`)
    - authority/private mismatch rejection (`T5`)
    - MySL sync on submit (`T6`)
    - MySL sync on cancel (`T7`)
  - suite pass: 7/7.
  - [apps/api/tests/integration/clozapineDisciplineBarrier.int.test.ts](../../../../apps/api/tests/integration/clozapineDisciplineBarrier.int.test.ts)
  - pass: 14/14.

## Gate results (local)

- `cd packages/shared && npx vitest run --config vitest.config.ts src/prescription.schemas.test.ts` -> pass (1 file, 4 tests)
- `cd apps/api && npx vitest run --config vitest.config.ts tests/unit/myslMedicationSync.test.ts` -> pass (1 file, 4 tests)
- `cd apps/api && npm run test:integration -- bugP5IhiStatusPrescribeGate.int.test.ts clozapineDisciplineBarrier.int.test.ts` -> pass
- `npx tsc --noEmit -p packages/shared/tsconfig.json` -> pass
- `cd apps/api && npx tsc --noEmit` -> pass

## Remaining closure gates

- Staging replay across NPDS + MySL enabled environment for:
  - authority submit variants (written/phone/streamlined/private mismatch fail)
  - MySL write path telemetry and failure analytics
- Post-staging evidence append, then move bug states from `in_progress` to `fixed`.
