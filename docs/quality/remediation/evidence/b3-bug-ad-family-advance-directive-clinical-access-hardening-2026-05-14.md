# B1/B2/B3 Evidence — BUG-AD Family Phase-1 (Advance-Directive Clinical Access Hardening)

Date: 2026-05-14  
Lane: B1/B2/B3 (command consolidation family residual)  
Scope: `BUG-AD-*` family phase-1 hardening on advance-directive route surface

## Objective

Eliminate route-local hardcoded role literals on advance-directive endpoints and enforce the clinical-access gate through canonical shared guards, with permanent regression prevention.

## Changes Landed

1. Route authorization convergence:
   - Updated `apps/api/src/features/advance-directives/advanceDirectiveRoutes.ts`.
   - Removed route-local `requireRoles([...])` gate and local `ROLES` literal.
   - Added canonical `requireClinicalAccessRole(buildAuthContext(req))` middleware.
   - Kept module gate (`requireModuleRead(MODULE_KEYS.ADVANCE_DIRECTIVES)`) and service-layer permission checks as the second and third rails.
   - Middleware order now enforces clinical-role denial before module-read denial on operational-only roles.

2. Regression guard:
   - Added `scripts/guards/check-no-hardcoded-role-literal-advance-directives.ts`.
   - Wired script: `guard:no-hardcoded-role-literal-advance-directives` in root `package.json`.
   - Guard fails on reintroduction of:
     - `requireRoles(...)`
     - local `const ROLES = [...]`
   - Guard also requires `requireClinicalAccessRole(...)` presence.

3. Integration proof:
   - Added `apps/api/tests/integration/bugAdFamilyClinicalAccessGuard.int.test.ts`.
   - Asserts receptionist receives deterministic `403 CLINICAL_ACCESS_DENIED` for:
     - `GET /api/v1/advance-directives/patient/:patientId`
     - `POST /api/v1/advance-directives`

## Verification (same session)

- `npm run guard:no-hardcoded-role-literal-advance-directives` => PASS
- `npm run test:integration -w apps/api -- tests/integration/bugAdFamilyClinicalAccessGuard.int.test.ts` => PASS (`2/2`)
- `npm run test:integration -w apps/api -- tests/integration/bug565AdvanceDirectiveOptimisticLock.int.test.ts` => PASS (`4/4`) (regression replay)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## Closure Posture

This evidence closes the **local implementation** for this `BUG-AD-*` phase-1 slice (role-literal drain + prevention guard + integration proof).  
Family-level closure remains pending broader `BUG-AD-*` residual implementation and rollout/post-deploy closure contract.

