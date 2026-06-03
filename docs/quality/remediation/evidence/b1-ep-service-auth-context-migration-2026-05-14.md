# B1 Evidence — EP Family Phase-4 Episode Service AuthContext Migration

Date: 2026-05-14  
Lane: B1 (Episode/referral transition engine)  
Scope: Local implementation + regression-proof only (rollout closure pending)

## Decision

Migrate `episodeService` to `AuthContext`-first service signatures and drain
the matching service-auth allowlist debt.

## Why

Episode service methods still accepted raw `(clinicId, actorId, ...)`
signatures. This preserved a legacy internal-caller seam and made it easier for
future call-sites to diverge from canonical auth context behavior.

## Changes

1. `apps/api/src/features/episode/episodeService.ts`
   - Migrated to `auth: AuthContext` first parameter:
     - `create`
     - `update`
     - `getById`
     - `listForPatient`
     - `close`
     - `createFromReferral`

2. Controller boundary convergence
   - `apps/api/src/features/episode/episodeController.ts`
   - All handlers now build and pass canonical `AuthContext` via
     `buildAuthContext(...)`.

3. Internal caller rewiring
   - `apps/api/src/features/referrals/referralService.ts`
   - `apps/api/src/features/referrals/referralRoutes.ts`
   - `apps/api/src/features/referrals/strategies/soloStrategy.ts`
   - `apps/api/src/features/referrals/strategies/teamStrategy.ts`
   - `apps/api/src/jobs/schedulers/referralSlaScheduler.ts`
   - Scheduler path now passes explicit system auth context for non-request
     execution.

4. Guard debt drain
   - `scripts/guards/check-service-auth-context.allowlist`
   - Removed 6 legacy entries for `episodeService.ts`.

## Verification

Executed in same session:

1. `npm run guard:service-auth-context`  
   PASS (`Every service method accepts auth: AuthContext as first parameter`)
2. `npm run guard:query-has-clinic-id`  
   PASS
3. `npm run guard:soft-delete-filter`  
   PASS
4. `npm run lint:changed`  
   PASS
5. `npm run typecheck`  
   PASS
6. `npm run test:integration -w apps/api -- tests/integration/bugRfClarificationCommandOwnership.int.test.ts tests/integration/bug602SchedulerCascadeRlsClose.int.test.ts tests/integration/episodeStateMachine.test.ts tests/integration/bugEpisodeMdtSaveRace.int.test.ts`  
   PASS (`2/2`, `2/2`, `5/5`, `3/3`)
7. `npm run guard:claude-discipline:ci`  
   PASS

## Closure Posture

This closes the local EP-family AuthContext migration for episode service
surfaces and drains the corresponding guard debt. Full BUG-EP family closure
remains pending residual implementation matrix and rollout closure evidence.
