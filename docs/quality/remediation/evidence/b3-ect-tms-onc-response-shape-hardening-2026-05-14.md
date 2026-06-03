# B3 Evidence — ECT/TMS/ONC Response-Shape Hardening (2026-05-14)

## Scope

- Lane: `B1/B2/B3` (B3 family hardening slice)
- Surfaces:
  - `apps/api/src/features/ect/ectRoutes.ts`
  - `apps/api/src/features/tms/tmsRoutes.ts`
  - `apps/api/src/features/oncology/oncologyRoutes.ts`
  - `scripts/guards/check-response-shape-validated.allowlist`
  - `apps/api/tests/unit/bugEctTmsCourseRelationshipGuards.test.ts`
  - `apps/api/tests/unit/bugOncologyResponseShapeValidation.test.ts` (new)

## Structural changes landed

1. ECT routes now use explicit response schemas before every `res.json`:
   - `EctCourseResponseSchema.parse(course)`
   - `EctSessionResponseSchema.parse(session)`
   - `EctByPatientResponseSchema.parse(data)`
   - `EctCourseSessionsResponseSchema.parse({ sessions })`

2. TMS routes now use explicit response schemas before every `res.json`:
   - `TmsCourseResponseSchema.parse(course)`
   - `TmsSessionResponseSchema.parse(session)`
   - `TmsByPatientResponseSchema.parse(data)`
   - `TmsCourseSessionsResponseSchema.parse({ sessions })`

3. Oncology routes now fail closed at response boundary with schema-validated envelopes using shared oncology response schemas:
   - `ConditionsListResponseSchema`, `ConditionWriteResponseSchema`
   - `TnmListResponseSchema`, `TnmWriteResponseSchema`
   - `EcogListResponseSchema`, `EcogWriteResponseSchema`
   - `TreatmentPlansListResponseSchema`, `TreatmentPlanWriteResponseSchema`
   - `ChemoCyclesListResponseSchema`, `ChemoCycleWriteResponseSchema`
   - `TumourBoardListResponseSchema`, `TumourBoardWriteResponseSchema`

4. `BUG-638-CASCADE-MIGRATE-MAPPER-CONSUMERS` debt drain:
   - Removed allowlist rows for:
     - `advanceDirectiveRoutes.ts` (3)
     - `ectRoutes.ts` (4)
     - `tmsRoutes.ts` (4)
     - `oncologyRoutes.ts` (12)
   - Total removed: **23** rows.

## Regression-proof additions

- Extended:
  - `apps/api/tests/unit/bugEctTmsCourseRelationshipGuards.test.ts`
    - now asserts schema-validated response parse paths are present on ECT/TMS routes.
- Added:
  - `apps/api/tests/unit/bugOncologyResponseShapeValidation.test.ts`
    - asserts all oncology list/write routes use schema-validated response envelopes.

## Verification (same session)

- `npm run guard:response-shape-validated` ✅ PASS  
  - scanned `784` files, allowlist reduced to `910` entries.
- `npm run test -w apps/api -- tests/unit/bugEctTmsCourseRelationshipGuards.test.ts tests/unit/bugOncologyResponseShapeValidation.test.ts` ✅ PASS (`8/8`)
- `npm run test:integration -w apps/api -- tests/integration/bugOncCommandOwnership.int.test.ts` ✅ PASS (`2/2`)
- `npm run lint:changed` ✅ PASS
- `npm run typecheck` ✅ PASS

## Outcome

- Response-shape drift risk is reduced across ECT/TMS/Oncology surfaces.
- These route families no longer rely on `check-response-shape-validated` allowlist exemptions for the drained entries.
- Guard + source tests now enforce this contract mechanically.
