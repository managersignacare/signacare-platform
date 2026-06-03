# B1 Evidence — RF Family Phase-6 RBAC Matrix Closure

Date: 2026-05-14  
Lane: B1 (Episode/referral transition engine)  
Scope: Local implementation + regression-proof only (rollout closure pending)

## Decision

Close the remaining local RF-family RBAC gap by enforcing explicit
`requirePermission(...)` middleware across referral mutation routes and adding a
deterministic Role x Permission integration matrix.

## Why

Command ownership was already in place for clarification, state, and task
transitions, but mutation endpoints still had inconsistent permission boundary
enforcement at the route layer. This could allow future role/permission drift
to re-open RF-family bugs silently.

## Changes

1. Centralized permission-gate constants in routes
   - `apps/api/src/features/referrals/referralRoutes.ts`
   - Added:
     - `canCreateReferral = requirePermission('referral:create')`
     - `canUpdateReferral = requirePermission('referral:update')`
     - `canTriageReferral = requirePermission('referral:triage')`
     - `canAssignReferral = requirePermission('referral:assign')`

2. Applied gates to RF mutation surfaces
   - `POST /referrals`
   - `PATCH /referrals/:id`
   - `PATCH /referrals/by-episode/:episodeId`
   - `POST /referrals/:id/triage`
   - `POST /referrals/:id/assign`
   - `POST /referrals/:id/accept`
   - `POST /referrals/:id/decline`
   - `POST /referrals/:id/notes`
   - `POST /referrals/:id/decision`
   - `POST /referrals/:id/attachments`
   - `POST /referrals/:id/ocr-confirm`
   - `POST /referrals/:id/allocate`
   - `POST /referrals/:id/offers/:offerId/respond`

3. Added RBAC regression matrix proof
   - `apps/api/tests/integration/bugRfRbacPermissionMatrix.int.test.ts`
   - Asserts:
     - receptionist denied triage (`403`) and clinician allowed (`200`)
     - clinician denied assign (`403`) and referral coordinator allowed (`200`)

## Verification

Executed in same session:

1. `npm run test:integration -w apps/api -- tests/integration/bugRfRbacPermissionMatrix.int.test.ts tests/integration/bugRfTaskTransitionCommandOwnership.int.test.ts tests/integration/bugRfReferralStateCommandOwnership.int.test.ts tests/integration/bugRfClarificationCommandOwnership.int.test.ts`  
   PASS (all 4 files)
2. `npm run test:integration -w apps/api -- tests/integration/bug415ReferralStateMachine.int.test.ts`  
   PASS (`4/4`)
3. `npm run guard:controller-repo-write-bypass`  
   PASS
4. `npm run guard:query-has-clinic-id`  
   PASS
5. `npm run guard:response-shape-validated`  
   PASS
6. `npm run lint:changed`  
   PASS
7. `npm run typecheck`  
   PASS
8. `npm run guard:claude-discipline:ci`  
   PASS

## Closure Posture

RF-family local RBAC/cross-tenant matrix residual is closed for current B1
scope. Remaining closure criteria are rollout/canary/burn-in evidence and
catalogue flips per lane contract.

