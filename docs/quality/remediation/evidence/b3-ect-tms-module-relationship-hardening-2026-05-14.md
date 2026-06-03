# B1/B2/B3 Evidence — BUG-ECT / BUG-TMS Family Phase-1

Date: 2026-05-14  
Lane: B1/B2/B3 (procedures family)  
Scope: `BUG-ECT-*`, `BUG-TMS-*` phase-1 hardening

## Objective

Close two recurring access-control seams on ECT/TMS surfaces:
1. missing module-read/write rails at route boundary
2. missing patient-relationship checks on course-linked session operations

## Changes

1. Route module-access convergence:
   - `apps/api/src/features/ect/ectRoutes.ts`
     - added `requireModuleRead(MODULE_KEYS.ECT)` router rail
     - added `requireModuleWrite(MODULE_KEYS.ECT)` on `POST /courses` and `POST /courses/:courseId/sessions`
   - `apps/api/src/features/tms/tmsRoutes.ts`
     - added `requireModuleRead(MODULE_KEYS.TMS)` router rail
     - added `requireModuleWrite(MODULE_KEYS.TMS)` on `POST /courses` and `POST /courses/:courseId/sessions`
2. Service course-lineage relationship hardening:
   - `apps/api/src/features/ect/ectService.ts`
     - `recordSession(...)` now enforces `requireSpecialty(...)` + `requirePatientRelationship(...)` against resolved course patient
     - `listSessionsByCourse(...)` now resolves course with clinic scope, fails closed on not-found, then enforces `requirePatientRelationship(...)`
   - `apps/api/src/features/tms/tmsService.ts`
     - `recordSession(...)` now enforces `requireSpecialty(...)` + `requirePatientRelationship(...)` against resolved course patient
     - `listSessionsByCourse(...)` now resolves course with clinic scope, fails closed on not-found, then enforces `requirePatientRelationship(...)`
3. Regression source guards:
   - added `apps/api/tests/unit/bugEctTmsCourseRelationshipGuards.test.ts`
   - pins module rails + relationship/specialty enforcement on course-linked surfaces

## Regression Proof

- `npm run test -w apps/api -- tests/unit/bugEctTmsCourseRelationshipGuards.test.ts` => PASS (`4/4`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS

## Outcome

ECT/TMS mutation/read surfaces now enforce module rails and fail-closed patient-lineage checks on course-linked paths, reducing cross-patient-in-clinic drift risk on high-risk treatment-session operations.
