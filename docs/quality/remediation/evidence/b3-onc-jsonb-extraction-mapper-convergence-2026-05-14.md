# B1/B2/B3 Evidence — BUG-ONC Family Phase-4 (JSONB Extraction Mapper Convergence)

Date: 2026-05-14  
Lane: B1/B2/B3 (B3 oncology family)  
Scope: `BUG-ONC-*` chemo-cycle response-mapper SSoT convergence

## Objective

Remove duplicate route-level JSONB parsing and enforce a single canonical mapper path for chemo-cycle response payload extraction.

## Changes

1. Canonical mapper exported from repository:
   - `apps/api/src/features/oncology/oncologyRepository.ts`
   - Added `mapChemoCycleToResponse(row)` with:
     - deterministic date/time normalization
     - JSONB extraction for `dose_modifications` and `toxicity_ctcae`
2. Route boundary rewired to mapper SSoT:
   - `apps/api/src/features/oncology/oncologyRoutes.ts`
   - Removed duplicate route-local JSONB parse helper/mapping path
   - Chemo-cycle list/create responses now use `mapChemoCycleToResponse(...)`
3. Guard debt drained:
   - `scripts/guards/check-jsonb-extraction.allowlist`
   - Removed ONC exemption row for `apps/api/src/features/oncology/oncologyRepository.ts`

## Regression Proof

1. Structural guard:
   - `npm run guard:jsonb-extraction` => PASS
2. Quality gates:
   - `npm run lint:changed` => PASS
   - `npm run typecheck` => PASS
3. Oncology behavior replay:
   - `npm run test:integration -w apps/api -- tests/integration/bugOncCommandOwnership.int.test.ts tests/integration/bugOncCtcaeContract.int.test.ts` => PASS (`2/2` + `2/2`)

## Outcome

Chemo-cycle JSONB extraction now has a single canonical mapper path, and ONC no longer depends on a file-level `guard:jsonb-extraction` exemption for this surface.
