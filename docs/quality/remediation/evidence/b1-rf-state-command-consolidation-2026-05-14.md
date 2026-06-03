# B1 Evidence — RF Family Phase-4 Referral State Command Consolidation

Date: 2026-05-14  
Lane: B1 (Episode/referral transition engine)  
Scope: Local implementation + regression-proof only (rollout closure pending)

## Decision

Extract referral state mutation logic from route handlers into a dedicated
command module so referral routes stop owning raw mutation orchestration.

## Why

Two referral mutation endpoints still performed inline DB write orchestration
inside `referralRoutes.ts`, which is the same recurrence mechanism B1 is
draining across episode/referral surfaces.

## Changes

1. Added command module
   - `apps/api/src/features/referrals/referralStateCommands.ts`
   - New command surfaces:
     - `appendReferralNote(...)`
     - `updateReferralStatusByEpisode(...)`

2. Rewired route-level mutation paths
   - `apps/api/src/features/referrals/referralRoutes.ts`
   - `POST /referrals/:id/notes` now invokes
     `referralStateCommands.appendReferralNote(...)`.
   - `PATCH /referrals/by-episode/:episodeId` now invokes
     `referralStateCommands.updateReferralStatusByEpisode(...)`.
   - Route handlers now perform schema parsing + response shaping only.

3. Regression-proof integration coverage
   - Added `apps/api/tests/integration/bugRfReferralStateCommandOwnership.int.test.ts`
   - Verifies:
     - by-episode status transition update path
     - notes timeline append path
     - persisted DB invariants for both paths

## Verification

Executed in same session:

1. `npm run test:integration -w apps/api -- tests/integration/bugRfReferralStateCommandOwnership.int.test.ts tests/integration/bugRfClarificationCommandOwnership.int.test.ts`  
   PASS (`2/2` + `2/2`)
2. `npm run guard:controller-repo-write-bypass`  
   PASS
3. `npm run guard:query-has-clinic-id`  
   PASS
4. `npm run guard:soft-delete-filter`  
   PASS
5. `npm run lint:changed`  
   PASS
6. `npm run typecheck`  
   PASS
7. `npm run guard:claude-discipline:ci`  
   PASS

## Closure Posture

This closes one additional B1 command-ownership seam on referral mutation
surfaces. Full RF-family closure remains pending residual RBAC/cross-tenant
matrix completion and rollout-closure evidence.
