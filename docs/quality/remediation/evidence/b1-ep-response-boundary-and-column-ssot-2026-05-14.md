# B1 Evidence — BUG-EP Family Residual Closure (Response Boundary + Column SSoT)

Date: 2026-05-14  
Lane: B1 (episode family residuals)  
Scope: `BUG-EP-*` local residual drain

## Objective

Close remaining local residual debt on the episode surface by enforcing fail-closed response boundaries and removing hand-written column-list drift points.

## Changes

1. Response-boundary schema enforcement:
   - `apps/api/src/features/episode/episodeController.ts`
   - `apps/api/src/features/episode/episodeRoutes.ts`
   - Added explicit parse-at-boundary contracts on list/read/write surfaces, including discharge-summary branches.
2. Canonical JSONB extraction alignment on discharge-summary responses:
   - `apps/api/src/features/episode/episodeRoutes.ts`
   - Added canonical extraction mappers for summary notes/medications.
3. Column-list SSoT convergence:
   - `apps/api/src/features/episode/episodeRepository.ts`
   - Replaced local hand-written list with generated `EPISODES_COLUMNS`.
4. Allowlist debt drain:
   - `scripts/guards/check-response-shape-validated.allowlist`
   - `scripts/guards/check-jsonb-extraction.allowlist`
   - `scripts/guards/check-no-hardcoded-column-lists.allowlist`
   - Removed EP-family rows now covered by structural enforcement.

## Regression Proof

1. Family-targeted tests:
   - `npm run test -w apps/api -- tests/unit/bugEpisodeMdtLookupClinicId.test.ts` => PASS (`5/5`)
   - `npm run test:integration -w apps/api -- tests/integration/episodeDischargeSummaryClinicScope.int.test.ts` => PASS (`1/1`)
2. Guard pack:
   - `npm run guard:response-shape-validated` => PASS
   - `npm run guard:jsonb-extraction` => PASS
   - `npm run guard:no-hardcoded-column-lists` => PASS
3. Global replay:
   - `npm run lint:changed` => PASS
   - `npm run typecheck` => PASS
   - `npm run guard:all` => PASS

## Outcome

For current B1 scope, EP-family local engineering residuals are closed; remaining EP-family work is rollout closure evidence (canary + burn-in + post-burn-in).
