# B1/B2/B3 Evidence — BUG-AD Family Phase-3 (JSONB Extraction Allowlist Drain)

Date: 2026-05-14  
Lane: B1/B2/B3 (B3 advance-directive family)  
Scope: `BUG-AD-*` mechanical guard-debt drain for JSONB extraction

## Objective

Remove stale JSONB extraction allowlist debt from the advance-directive route surface so AD remains fail-closed under the global extraction guard.

## Changes

1. Drained stale allowlist row:
   - `scripts/guards/check-jsonb-extraction.allowlist`
   - Removed:
     - `apps/api/src/features/advance-directives/advanceDirectiveRoutes.ts`
2. Kept canonical extraction boundary:
   - AD response extraction remains centralized in
     `mapAdvanceDirectiveRowToResponse(...)` at repository boundary.

## Regression Proof

1. Structural guard:
   - `npm run guard:jsonb-extraction` => PASS
2. AD clinical + optimistic-lock replay:
   - `npm run test:integration -w apps/api -- tests/integration/bugAdFamilyClinicalAccessGuard.int.test.ts tests/integration/bug565AdvanceDirectiveOptimisticLock.int.test.ts` => PASS (`3/3` + `4/4`)
3. Quality gate:
   - `npm run lint:changed` => PASS

## Outcome

Advance-directive JSONB extraction is now enforced without a file-level exemption on `advanceDirectiveRoutes.ts`, reducing silent-regression risk in the AD family.
