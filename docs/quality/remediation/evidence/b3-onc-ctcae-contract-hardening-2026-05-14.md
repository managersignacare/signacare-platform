# B1/B2/B3 Evidence — BUG-ONC Family Phase-3 (CTCAE Contract Hardening)

Date: 2026-05-14  
Lane: B1/B2/B3 (B3 oncology family)  
Scope: `BUG-ONC-*` CTCAE decision-path hardening

## Objective

Eliminate unbounded JSON acceptance for chemo-cycle toxicity payloads so CTCAE inputs are structurally valid and grade-bounded at the shared route contract boundary.

## Changes

1. Shared schema contract hardened:
   - `packages/shared/src/oncology.schemas.ts`
   - Added explicit CTCAE schemas:
     - `CtcaeGradeSchema` (`0..5`, integer)
     - `CtcaeEventSchema` (term + bounded grade + optional attribution/serious/observedAt/notes)
     - `ToxicityCtcaeSchema` (record of legacy grade values or structured events)
2. Request boundary hardened:
   - `CreateChemoCycleSchema.toxicityCtcae` now uses `ToxicityCtcaeSchema` instead of `record<unknown>`.
3. Response boundary hardened:
   - `ChemoCycleResponseSchema.toxicityCtcae` now uses the same `ToxicityCtcaeSchema`.
4. Regression integration proof added:
   - `apps/api/tests/integration/bugOncCtcaeContract.int.test.ts`
   - Positive and negative-path CTCAE validation assertions.

## Regression Proof

1. Integration:
   - `npm run test:integration -w apps/api -- tests/integration/bugOncCtcaeContract.int.test.ts` => PASS (`2/2`)
   - Assertions:
     - accepts mixed legacy + structured CTCAE payload (`201`)
     - rejects out-of-range grade (`422 VALIDATION_ERROR`)
2. Oncology sibling replay:
   - `npm run test:integration -w apps/api -- tests/integration/bugOncCommandOwnership.int.test.ts` => PASS (`2/2`)
3. Structural/quality gates:
   - `npm run lint:changed` => PASS
   - `npm run typecheck` => PASS
   - `npm run guard:response-shape-validated` => PASS

## Outcome

Chemo-cycle toxicity now enforces a bounded, auditable CTCAE contract at the shared schema boundary, closing the ONC residual where malformed toxicity payloads could silently enter clinical workflow state.
