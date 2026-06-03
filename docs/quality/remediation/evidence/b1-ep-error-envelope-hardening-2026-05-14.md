# B1/B2/B3 Evidence — BUG-EP Family Error-Envelope Hardening

Date: 2026-05-14  
Lane: B1/B2/B3 (episode family)  
Scope: `BUG-EP-*` route-boundary fail-closed envelope convergence

## Objective

Eliminate residual inline error responses in episode routes so all failure paths flow through canonical `AppError` handling and global error middleware.

## Changes

1. Canonical `AppError` conversion in `apps/api/src/features/episode/episodeRoutes.ts`:
   - Replaced inline `res.status(...).json(...)` paths with `throw new AppError(...)` for:
     - roster authorization (`NOT_OWN_ROSTER`, `AUTH_REQUIRED`, `NOT_TEAM_MEMBER`)
     - allocation payload validation (`VALIDATION_ERROR`)
     - allocation/discharge/closure not-found checks (`NOT_FOUND`)
     - consultant-sign permission checks (`CONSULTANT_SIGN_REQUIRED`)
2. Allowlist debt drain:
   - `scripts/guards/check-error-envelope-consistency.allowlist`
   - Removed `12` stale `episodeRoutes.ts` rows now covered by canonical envelope behavior.

## Regression Proof

- `npm run guard:error-envelope-consistency` => PASS (allowlist reduced `337 -> 325`)
- `npm run test -w apps/api -- tests/unit/bugEpisodeMdtLookupClinicId.test.ts` => PASS (`5/5`)
- `npm run test:integration -w apps/api -- tests/integration/episodeDischargeSummaryClinicScope.int.test.ts tests/integration/bugEpisodeMdtSaveRace.int.test.ts` => PASS (`1/1` + `3/3`)
- `npm run guard:fix-registry-decisiveness` => PASS

## Outcome

Episode route failures are now structurally uniform and fail-closed under shared error middleware, removing a recurring route-level error-shape drift class from the EP family.
