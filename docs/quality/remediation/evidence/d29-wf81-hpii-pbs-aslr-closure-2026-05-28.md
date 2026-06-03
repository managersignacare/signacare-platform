# D29 — WF81 Closure: HPI-I Gate + PBS Authority + ASLR Write Path

**Date:** 2026-05-28  
**Owner:** Platform API  
**Bugs closed in this slice:** `BUG-WF81-HPII-MISSING`, `BUG-WF81-PBS-AUTHORITY-MISSING`, `BUG-WF81-ASLR-READONLY`

## Scope

1. Confirm strict prescriber HPI-I enforcement is fail-closed with no WARN bypass path.
2. Confirm PBS authority requirements are enforced at create + submit boundaries.
3. Confirm ASLR/MySL is write-enabled from prescribe/cancel flows (no longer read-only).

## Verified implementation surfaces

- HPI-I guard
  - `apps/api/src/shared/authGuards.ts` (`requireValidHpii`)
  - `apps/api/src/features/prescriptions/prescriptionService.ts` (`create`, `submitErx`)
  - `apps/api/src/features/clozapine/clozapineService.ts`

- PBS authority contract
  - `packages/shared/src/prescription.schemas.ts` (`PrescriptionCreateSchema` superRefine)
  - `apps/api/src/features/prescriptions/prescriptionService.ts`
    - `canonicalizeErxPayloadFromPrescription(...)`
    - `assertPbsAuthorityConsistency(...)`
  - `apps/api/src/features/prescriptions/erxRegulatoryContract.ts`

- ASLR/MySL write-back
  - `apps/api/src/integrations/escript/myslClient.ts`
    - `syncMedicationRequestFromPrescription(...)`
  - `apps/api/src/features/prescriptions/prescriptionService.ts`
    - submit success sync (`status: active`)
    - cancel sync (`status: cancelled`)

## Regression proof run (local)

- `cd packages/shared && npx vitest run --config vitest.config.ts src/prescription.schemas.test.ts`
  - PASS (4/4)
- `cd apps/api && npx vitest run --config vitest.config.ts tests/unit/myslMedicationSync.test.ts`
  - PASS (4/4)
- `cd apps/api && npm run test:integration -- bugP5IhiStatusPrescribeGate.int.test.ts hpiiValidation.int.test.ts clozapineDisciplineBarrier.int.test.ts`
  - PASS (`7/7`, `11/11`, `14/14`)

## Closure decision

These three bugs are marked **fixed** in the pre-deploy backlog because the code path and regression proofs are complete and green locally.

Operational verification in staging (NPDS/MySL endpoint replay and telemetry review) remains tracked as release verification activity, not as unresolved implementation debt.
