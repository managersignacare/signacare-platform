# A4c BUG-331 Local Evidence — Ambient Worker Pickup-Time Relationship Gate

**Date:** 2026-05-14  
**Lane:** A4c (Platform Hygiene + LLM Runtime Governance)  
**BUG:** `BUG-331`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Added a canonical ambient pickup-time relationship gate in the AI worker.
   - File: `apps/api/src/jobs/workers/aiWorker.ts`
   - New function: `recheckAmbientPatientRelationshipAtPickup(...)`
   - Contract:
     - applies only to `action === 'ambient'`,
     - requires `patientId`, `staffId`, and `clinicId` in queued job payload,
     - fails closed with `AMBIENT_JOB_CONTEXT_INVALID` when context is incomplete.

2. Enforced live staff-state validation at worker pickup.
   - Worker now verifies queued `staffId` is:
     - present in `staff`,
     - in the same clinic as queued `clinicId`,
     - active (`is_active=true`),
     - non-soft-deleted (`deleted_at IS NULL` query filter).
   - Fail-closed error: `AMBIENT_STAFF_CONTEXT_INVALID`.

3. Re-used canonical clinical-rail guards before any LLM work starts.
   - Worker builds `AuthContext` from live staff row.
   - Runs:
     - `requireClinicalAccessRole(auth)`
     - `requirePatientRelationship(auth, patientId)`
   - This closes queue-delay drift where relationship/eligibility can change between enqueue and pickup.

4. Added enqueue-time defense-in-depth for ambient jobs.
   - File: `apps/api/src/features/llm/aiJobRoutes.ts`
   - For `action='ambient'`:
     - requires `patientId` (422 `VALIDATION_ERROR` if missing),
     - verifies relationship at submission time.
   - Worker re-check remains authoritative for delayed/stale jobs.

## Regression Proof (Local)

1. `npm run lint:changed` => PASS  
2. `npm run typecheck` => PASS  
3. `npm run guard:soft-delete-filter` => PASS  
4. `npm run guard:fix-registry-decisiveness` => PASS  
5. `npm run test:integration -w apps/api -- tests/integration/bug331AmbientWorkerPickupRelationship.int.test.ts` => PASS (`4/4`)

Integration scenarios pinned in `bug331AmbientWorkerPickupRelationship.int.test.ts`:
- `BUG-331-1`: missing ambient context fails (`AMBIENT_JOB_CONTEXT_INVALID`)
- `BUG-331-2`: no patient relationship fails (`NO_PATIENT_RELATIONSHIP`)
- `BUG-331-3`: active relationship passes
- `BUG-331-4`: deactivated staff fails (`AMBIENT_STAFF_CONTEXT_INVALID`)

## Post-Deploy Closure Items (Still Required)

1. Canary replay with delayed ambient queue pickup (relationship-change scenario included).
2. Burn-in + post-burn-in verification that no stale-relationship ambient jobs are processed.
3. Catalogue row flip only after rollout closure contract is satisfied.
