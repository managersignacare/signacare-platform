# B1 Evidence — RF/EP Soft-Delete Filter Drain (2026-05-14)

Scope: continue B1 residual closure by draining touched-file soft-delete debt on referral and episode command/read surfaces.

## Changes Landed

1. Referral surfaces hardened to exclude soft-deleted rows:
   - `apps/api/src/features/referrals/referralFeedbackService.ts`
     - staff lookup now enforces `whereNull('deleted_at')`.
   - `apps/api/src/features/referrals/strategies/teamStrategy.ts`
     - both clinician staff lookups now enforce `whereNull('deleted_at')`.
     - patient-name lookup now enforces `whereNull('deleted_at')`.
   - `apps/api/src/jobs/schedulers/referralSlaScheduler.ts`
     - patient lookup now enforces `whereNull('deleted_at')`.

2. Episode discharge/closure surfaces hardened:
   - `apps/api/src/features/episode/episodeRoutes.ts`
     - discharge generate/submit/sign/get and close-with-vetting/close-sign episode reads/updates now enforce `whereNull('deleted_at')`.
     - discharge generate patient lookup now enforces `whereNull('deleted_at')`.

3. Allowlist debt drained:
   - removed 5 referral/scheduler entries from `scripts/guards/check-soft-delete-filter.allowlist`.
   - removed 2 remaining `referralRoutes.ts` soft-delete entries after replay verification.
   - removed 8 `episodeRoutes.ts` entries from `scripts/guards/check-soft-delete-filter.allowlist`.
   - allowlist count reduced `149 -> 139`.

4. Regression-proof source test added:
   - `apps/api/tests/unit/bugRfSoftDeleteScope.test.ts`
   - Pins soft-delete predicates on the hardened RF paths.

## Verification (Same Session)

- `npm run test -w apps/api -- tests/unit/bugRfSoftDeleteScope.test.ts` => PASS (`4/4`)
- `npm run test -w apps/api -- tests/unit/bugEpisodeMdtLookupClinicId.test.ts tests/unit/bugRfSoftDeleteScope.test.ts` => PASS (`9/9`)
- `npm run test:integration -w apps/api -- tests/integration/bugRfClarificationCommandOwnership.int.test.ts tests/integration/bug602SchedulerCascadeRlsClose.int.test.ts` => PASS (`2/2` + `2/2`)
- `npm run guard:soft-delete-filter` => PASS
- `npm run guard:query-has-clinic-id` => PASS
- `npm run guard:service-auth-context` => PASS
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## Closure Impact

- Tightens B1 recurrence control for soft-delete leaks on active RF/EP paths.
- Drains concrete guard debt in files actively touched by B1 work, preserving fail-closed guard signal.
