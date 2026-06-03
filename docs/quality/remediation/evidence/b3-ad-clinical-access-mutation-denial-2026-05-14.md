# B1/B2/B3 Evidence — BUG-AD Family Phase-2 (Clinical-Access Denial Matrix)

Date: 2026-05-14  
Lane: B1/B2/B3 (B3 advance-directive family)  
Scope: `BUG-AD-*` mutation-surface denial proof

## Objective

Extend AD-family clinical-access regression proof so operational roles are denied consistently across read and write surfaces, including update mutation paths.

## Changes

1. Integration matrix extended:
   - `apps/api/tests/integration/bugAdFamilyClinicalAccessGuard.int.test.ts`
   - Added PATCH denial assertion for receptionist on `/api/v1/advance-directives/:id`.
2. Fixture hardening:
   - Captured created directive `id` + `lockVersion` from admin bootstrap create, then exercised receptionist PATCH with optimistic-lock payload to ensure denial is role-driven (not malformed-input driven).

## Regression Proof

1. Integration:
   - `npm run test:integration -w apps/api -- tests/integration/bugAdFamilyClinicalAccessGuard.int.test.ts` => PASS (`3/3`)
   - Assertions:
     - receptionist GET list denied (`403 CLINICAL_ACCESS_DENIED`)
     - receptionist POST create denied (`403 CLINICAL_ACCESS_DENIED`)
     - receptionist PATCH update denied (`403 CLINICAL_ACCESS_DENIED`)
2. Repo health:
   - `npm run lint:changed` => PASS

## Outcome

AD-family role-guard proof now covers both read and mutation surfaces, reducing drift risk where update paths could silently diverge from GET/POST protections.
