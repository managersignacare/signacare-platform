# B1 Evidence — RF Family Phase-2 Feedback Service AuthContext Migration

Date: 2026-05-14  
Lane: B1 (Episode/referral transition engine)  
Scope: Local implementation + regression-proof only (rollout closure pending)

## Decision

Migrate `referralFeedbackService` to `AuthContext`-first service signatures and
drain associated service-auth allowlist debt.

## Why

Referral feedback service methods still accepted raw `(clinicId, userId, ...)`
shapes, which left the RF command path behind the AuthContext discipline used
across newer service surfaces.

This preserved a recurrence mechanism where internal callers could bypass
standard service-call identity context patterns.

## Changes

1. `apps/api/src/features/referrals/referralFeedbackService.ts`
   - Migrated to `auth: AuthContext` first parameter for:
     - `sendAcceptanceFeedback`
     - `sendRejectionFeedback`
     - `sendClosedNoResponseFeedback`
     - `sendClarificationRequest`

2. Call-site rewiring
   - `apps/api/src/features/referrals/strategies/soloStrategy.ts`
   - `apps/api/src/features/referrals/strategies/teamStrategy.ts`
   - `apps/api/src/features/referrals/referralClarificationCommands.ts`
   - `apps/api/src/jobs/schedulers/referralSlaScheduler.ts` (synthesized
     system auth context for non-request scheduler execution)

3. Guard debt drain
   - `scripts/guards/check-service-auth-context.allowlist`
   - Removed 4 allowlist entries for `referralFeedbackService` legacy signatures.

## Verification

Executed in same session:

1. `npm run guard:service-auth-context`  
   PASS (`Every service method accepts auth: AuthContext as first parameter`)
2. `npm run lint:changed`  
   PASS
3. `npm run test:integration -w apps/api -- tests/integration/bugRfClarificationCommandOwnership.int.test.ts`  
   PASS (`2/2`)
4. `npm run test:integration -w apps/api -- tests/integration/bug602SchedulerCascadeRlsClose.int.test.ts`  
   PASS (`2/2`)
5. `npm run typecheck`  
   PASS

## Closure Posture

This closes RF-family local AuthContext migration for the feedback service
surface. Lane-level RF closure remains pending residual RBAC/cross-tenant
matrix completion plus rollout closure contract.
