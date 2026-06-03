# B1/B2/B3 Evidence — B2 BUG-323 Follow-up (Clozapine Response-Shape Allowlist Drain)

Date: 2026-05-14  
Lane: B1/B2/B3 (B2 clozapine family)  
Scope: `BUG-323` local response-boundary hardening residual

## Objective

Remove remaining `BUG-638` response-shape allowlist debt on clozapine registration and blood-result controller surfaces by making route-boundary response validation explicit and fail-closed.

## Changes

1. Controller-boundary parse hardening:
   - `apps/api/src/features/clozapine/clozapineController.ts`
   - Added explicit response parses for:
     - registration list/get/create/update
     - blood-result list/create
   - Added named list schema wrappers:
     - `ClozapineRegistrationListResponseSchema`
     - `ClozapineBloodResultListResponseSchema`
2. Mapper false-positive cleanup:
   - `apps/api/src/features/clozapine/clozapineMappers.ts`
   - Reworded historical comments to avoid `res.json` token false-positive scanning in non-route files.
3. Allowlist debt drain:
   - `scripts/guards/check-response-shape-validated.allowlist`
   - Removed 7 clozapine rows:
     - 6 controller route rows
     - 1 mapper comment row

## Regression Proof

1. Structural guard:
   - `npm run guard:response-shape-validated` => PASS
2. Quality gates:
   - `npm run lint:changed` => PASS
   - `npm run typecheck` => PASS
3. Clinical integration replay:
   - `npm run test:integration -w apps/api -- tests/integration/clozapineDisciplineBarrier.int.test.ts tests/integration/clozapineAncThresholdGuards.int.test.ts` => PASS (`12/12` + `7/7`)

## Outcome

Clozapine registration and blood-result response emission is now explicitly schema-validated at the controller boundary, and this surface no longer relies on `BUG-638` allowlist exemptions.
