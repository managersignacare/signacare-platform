# B1 Evidence — BUG-EP Family Phase-2 Roster/Allocation Clinic Scope

Date: 2026-05-14  
Lane: B1 (Episode/referral transition engine)  
Scope: Local implementation + regression-proof only (rollout closure pending)

## Decision

Close the next concrete `BUG-EP-*` residual by hardening episode roster and
allocation read paths against cross-clinic drift, and pinning the invariant
with mechanical source guards.

## Why

Phase-1 already drained discharge-summary id-only episode accesses.  
Remaining episode roster/allocation paths still relied on indirect join safety:

1. Roster queries joined `patients` from `episodes.patient_id` without explicit
   `patients.clinic_id` / `patients.deleted_at` predicates.
2. Allocation team-name lookup resolved `org_units` by `id` only.

Even if FK shape usually prevents leakage, explicit clinic scoping is required
defense-in-depth for tenant-boundary invariants.

## Code Changes

1. `apps/api/src/features/episode/episodeRoutes.ts`
   - `GET /patients-by-clinician/:clinicianId`
     - added `.where('patients.clinic_id', req.clinicId)`
     - added `.whereNull('patients.deleted_at')`
   - `GET /patients-by-team/:team`
     - added `.where('patients.clinic_id', req.clinicId)`
     - added `.whereNull('patients.deleted_at')`
   - `GET /:id/allocation`
     - changed org-unit lookup from `where({ id: orgUnitId })`
       to `where({ id: orgUnitId, clinic_id: clinicId })`

2. `apps/api/tests/unit/bugEpisodeMdtLookupClinicId.test.ts`
   - added source guard asserting roster queries include patient clinic scope
     and patient soft-delete filter.
   - added source guard asserting allocation team lookup includes `clinic_id`.

## Verification

Executed in the same session:

1. `npm run test -w apps/api -- tests/unit/bugEpisodeMdtLookupClinicId.test.ts`  
   PASS (`5/5`)
2. `npm run guard:query-has-clinic-id`  
   PASS (`0` violations)
3. `npm run lint:changed`  
   PASS
4. `npm run typecheck`  
   PASS
5. `npm run guard:claude-discipline:ci`  
   PASS

## Closure Posture

This evidence closes the local phase-2 EP-family clinic-scope hardening slice.
`BUG-EP-*` remains open at lane level pending residual implementations plus
canary/burn-in/post-burn-in closure contract.
