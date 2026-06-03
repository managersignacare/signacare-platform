# B1/B2/B3 Evidence — BUG-ONC Family Phase-1 (Command Ownership + Clinic Lineage)

Date: 2026-05-14  
Lane: B1/B2/B3 (B3 oncology family)  
Scope: `BUG-ONC-*` phase-1 hardening

## Objective

Eliminate controller-level repository write orchestration on oncology mutation surfaces and block cross-clinic parent-id injection on child writes.

## Changes

1. Added canonical service owner:
   - `apps/api/src/features/oncology/oncologyService.ts`
   - AuthContext-first methods for all oncology list/create endpoints.
2. Rewired route handlers:
   - `apps/api/src/features/oncology/oncologyRoutes.ts`
   - Route handlers now parse + delegate; no direct `*Repo.create` calls.
3. Added lineage guard primitive:
   - `apps/api/src/features/oncology/oncologyRepository.ts`
   - New `treatmentPlanRepo.findById(clinicId, id)` for clinic-scoped plan lineage verification.
4. Drained stale allowlist debt:
   - Removed six oncology rows from `scripts/guards/check-controller-repo-write-bypass.allowlist`.

## Regression Proof

1. Integration:
   - `npm run test:integration -w apps/api -- tests/integration/bugOncCommandOwnership.int.test.ts` => PASS (`2/2`)
   - Assertions:
     - stage-group create with foreign-clinic `conditionId` returns `404 NOT_FOUND`
     - chemo-cycle create with foreign-clinic `planId` returns `404 NOT_FOUND`
2. Structural guards:
   - `npm run guard:controller-repo-write-bypass` => PASS
   - `npm run guard:service-auth-context` => PASS
   - `npm run guard:query-has-clinic-id` => PASS
   - `npm run guard:response-shape-validated` => PASS
3. Repo health:
   - `npm run lint:changed` => PASS
   - `npm run typecheck` => PASS
   - `npm run guard:claude-discipline:ci` => PASS

## Outcome

The oncology route surface is now command/service-owned and fail-closed on clinic lineage for parent-linked child writes. Remaining ONC family closure work is broader workflow charter coverage + rollout contract evidence.
