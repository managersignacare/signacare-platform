# B3 Evidence — BUG-561 Treatment-Pathway Response Shape Convergence

Date: 2026-05-14  
Lane: B1/B2/B3 (command consolidation family residual)  
Scope: Local implementation + regression-proof only (rollout closure pending)

## Decision

Close the treatment-pathway response-shape drift by enforcing one canonical
camelCase contract across backend mapper output and frontend consumers.

## Why

`PathwaysPage` still tolerated snake_case fallback fields while backend had
already moved to canonical `TreatmentPathwayResponse` shape. The fallback layer
masked contract drift and allowed silent regressions.

## Changes

1. Frontend canonicalization
   - Updated `apps/web/src/features/treatment-pathways/pages/PathwaysPage.tsx`:
     - removed snake_case fallback readers (`pathway_name`, `pathway_type`,
       `total_sessions`, `completed_sessions`, `start_date`, `lock_version`);
     - row type now uses canonical camelCase-only fields;
     - create payload now emits canonical fields (`name`, `pathwayName`,
       `totalSessions`) to match backend schema expectations.

2. Backend fail-closed mapper hardening
   - Updated `apps/api/src/features/treatment-pathways/pathwayRoutes.ts`:
     - removed temporary fallback defaults in mapper
       (`pathwayType ?? r.name`, `totalSessions ?? 0`, `completedSessions ?? 0`);
     - added explicit canonical-field readers for `pathwayType`,
       `totalSessions`, `completedSessions`;
     - missing canonical milestone fields now fail closed with
       `PATHWAY_RESPONSE_SHAPE_INVALID`.

3. Regression-proof contract assertion
   - Updated `apps/api/tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts`:
     - TP-OL-7 now asserts canonical camelCase fields are present and snake_case
       siblings are absent in list response rows.

## Verification

Executed in same session:

1. `npm run test:integration -w apps/api -- tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts tests/integration/bug563TreatmentPathwayStateMachine.int.test.ts`  
   PASS (`7/7` + `4/4`)
2. `npm run lint:changed`  
   PASS
3. `npm run typecheck`  
   PASS
4. `npm run guard:claude-discipline:ci`  
   PASS

## Closure Posture

Local implementation for `BUG-561` is complete with fail-closed contract and
integration regression proof. Remaining closure criteria are rollout/canary/
burn-in evidence and catalogue flip per lane policy.

