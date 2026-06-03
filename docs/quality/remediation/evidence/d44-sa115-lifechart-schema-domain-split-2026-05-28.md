# D44 — SA-115 Lifechart Schema Domain Split (2026-05-28)

## Scope
- Bug: `BUG-SA-115`
- Goal: split oversized `lifeChartSchemaDomain.ts` into bounded modules without behavior drift.

## Changes
- Extracted schema core types + normalization primitives to:
  - `apps/web/src/features/patients/components/detail/tabs/lifeChartSchemaCore.ts`
- Extracted parse/normalize/stringify lifecycle to:
  - `apps/web/src/features/patients/components/detail/tabs/lifeChartSchemaNormalize.ts`
- Extracted heuristic synthesis + prompt builder to:
  - `apps/web/src/features/patients/components/detail/tabs/lifeChartSchemaHeuristics.ts`
- Converted legacy entrypoint into stable façade:
  - `apps/web/src/features/patients/components/detail/tabs/lifeChartSchemaDomain.ts`

## Structural outcome
- `lifeChartSchemaDomain.ts` reduced from 1001 LOC to 26 LOC.
- Domain concerns are now separated into:
  - Core model/normalization helpers
  - JSON ingestion/egress normalization
  - Heuristic synthesis + prompt construction

## Regression proof (local)
- `cd apps/web && npx tsc --noEmit` ✅
- `cd apps/web && npx vitest run src/features/patients/components/detail/tabs/lifeChartSchemaDomain.test.ts` ✅ (5/5)

## Verdict
- `BUG-SA-115` moved to **fixed**.
