# B1 Evidence — RF Family Phase-5 Task Transition Command Consolidation

Date: 2026-05-14  
Lane: B1 (Episode/referral transition engine)  
Scope: Local implementation + regression-proof only (rollout closure pending)

## Decision

Extract referral task-transition orchestration (`triage`, `assign`, `accept`,
`decline`) from route handlers into a dedicated command module.

## Why

These referral mutation endpoints still contained transition orchestration in
`referralRoutes.ts`. B1 requires command ownership of transitions to prevent
route-level drift and recurring inconsistent state-handling behavior.

## Changes

1. Added command module
   - `apps/api/src/features/referrals/referralTaskCommands.ts`
   - New command surfaces:
     - `triageReferral(...)`
     - `assignReferral(...)`
     - `acceptReferral(...)`
     - `declineReferral(...)`

2. Rewired route handlers
   - `apps/api/src/features/referrals/referralRoutes.ts`
   - Delegated:
     - `POST /referrals/:id/triage`
     - `POST /referrals/:id/assign`
     - `POST /referrals/:id/accept`
     - `POST /referrals/:id/decline`
   - Route handlers now parse input + map response only.

3. Regression-proof integration coverage
   - Added `apps/api/tests/integration/bugRfTaskTransitionCommandOwnership.int.test.ts`
   - Verifies:
     - triage path transitions `requested -> received` and writes coordinator
       metadata.
     - assign path transitions `received -> in_progress` and stores
       `assigned_to_staff_id`.

## Verification

Executed in same session:

1. `npm run test:integration -w apps/api -- tests/integration/bugRfTaskTransitionCommandOwnership.int.test.ts tests/integration/bugRfReferralStateCommandOwnership.int.test.ts tests/integration/bugRfClarificationCommandOwnership.int.test.ts`  
   PASS (`2/2`, `2/2`, `2/2`)
2. `npm run lint:changed`  
   PASS
3. `npm run typecheck`  
   PASS
4. `npm run guard:controller-repo-write-bypass`  
   PASS
5. `npm run guard:query-has-clinic-id`  
   PASS
6. `npm run guard:response-shape-validated`  
   PASS

## Closure Posture

This drains another B1 command-ownership seam on RF workflow transitions. Full
RF-family closure remains pending residual RBAC/cross-tenant matrix completion
and rollout-closure evidence.
