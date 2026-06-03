# B3 Evidence — BUG-ECT/TMS Family Residual Matrix (Session Lineage + Clinic Scope)

Date: 2026-05-14  
Lane: B1/B2/B3 (B3 ECT/TMS family)  
Scope: `BUG-ECT-*`, `BUG-TMS-*` local residual matrix proof

## Objective

Add live integration proof that ECT/TMS course-session surfaces are both relationship-safe and clinic-scoped (no foreign-course mutation/read by ID).

## Changes

1. Added integration matrix:
   - `apps/api/tests/integration/bugEctTmsSessionRelationshipScope.int.test.ts`
2. Test covers:
   - Own-clinic positive session record for ECT and TMS (`201`).
   - Foreign-clinic course-id mutation denial by clinic-scope lookup (`404 NOT_FOUND`).
   - Foreign-clinic course-id read denial on list-by-course surfaces (`404 NOT_FOUND`).
3. Uses canonical seeded clinics and explicit episode linkage so relationship checks are exercised in the same path as production runtime.

## Regression Proof

1. Integration:
   - `npm run test:integration -w apps/api -- tests/integration/bugEctTmsSessionRelationshipScope.int.test.ts` => PASS (`6/6`)
2. Family source guard replay:
   - `npm run test -w apps/api -- tests/unit/bugEctTmsCourseRelationshipGuards.test.ts` => PASS (`8/8`)
3. Global replay:
   - `npm run lint:changed` => PASS
   - `npm run typecheck` => PASS
   - `npm run guard:all` => PASS

## Outcome

ECT/TMS local residual matrix proof is now deterministic and fail-closed for current B3 scope; remaining ECT/TMS items are rollout closure evidence only.
