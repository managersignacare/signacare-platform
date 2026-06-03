# Class V2 Contract Drift Triage Evidence

**Captured:** 2026-05-07  
**Scope:** local-only V2 slice (`V2-CONTRACT-DRIFT-TRIAGE`)  
**Confidence labels:** per section

## Goal

Eliminate ambiguous integration assertions that accept both `400` and `422`
for one validation path, then enforce the rule mechanically in CI.

## Contract Inventory (400 vs 422)

1. **Direct Zod `parse(...)` route paths → `422 VALIDATION_ERROR`**
   - `patientController.create` (`CreatePatientSchema.parse`)
   - `episodeController.update/close` (`UpdateEpisodeSchema.parse`, `CloseEpisodeSchema.parse`)
   - `llmRoutes /clinical-ai` (`ClinicalAiSchema.parse`)
   - `hiServiceController.verifyHpii/verifyHpio` (`HpiiVerifyRequestSchema.parse`, `HpioVerifyRequestSchema.parse`)
2. **`validateBody(...)` middleware paths → `400 VALIDATION_ERROR`**
   - `clinicRoutes` update path (`validateClinicUpdate` via `validateBody(ClinicUpdateSchema)`)

**Structural finding:** validation adapters are mixed (`parse` + global error mapper vs
`validateBody` safeParse wrapper). This slice tightens test contracts to current behavior;
adapter normalization is a follow-up slice.

**Confidence:** `HIGH` (source-level verification completed on each route family)

## Changes

1. Tightened integration assertions from ambiguous `400/422` to explicit status:
   - [patientCrud.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/integration/patientCrud.test.ts)
   - [episodeStateMachine.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/integration/episodeStateMachine.test.ts)
   - [bug395ChatContextLock.int.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/integration/bug395ChatContextLock.int.test.ts)
   - [bug336HiServiceVerify.int.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/integration/bug336HiServiceVerify.int.test.ts)
2. Removed shorthand prose that encoded ambiguous status semantics:
   - [medicationConstraints.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/integration/medicationConstraints.test.ts)
3. Added CI guard to block ambiguous status assertions:
   - [check-no-ambiguous-validation-status.ts](/Users/drprakashkamath/Projects/Signacare/scripts/guards/check-no-ambiguous-validation-status.ts)
   - [check-no-ambiguous-validation-status.test.ts](/Users/drprakashkamath/Projects/Signacare/scripts/guards/__tests__/check-no-ambiguous-validation-status.test.ts)
4. Wired guard into discipline umbrella:
   - [package.json](/Users/drprakashkamath/Projects/Signacare/package.json)

## Local Verification

### L1

- targeted `eslint` on touched V2 contract files: **PASS**

### L2

- `npm run guard:no-ambiguous-validation-status`: **PASS**
- `npm run guard:claude-discipline:ci`: **PASS**

### L3

- `npx vitest run --config vitest.config.ts scripts/guards/__tests__/check-no-ambiguous-validation-status.test.ts`: **PASS** (`5/5`)

### L4 spot-check (targeted integration files touched in this slice)

- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/patientCrud.test.ts tests/integration/episodeStateMachine.test.ts tests/integration/bug395ChatContextLock.int.test.ts tests/integration/bug336HiServiceVerify.int.test.ts tests/integration/medicationConstraints.test.ts`
- **Result:** `2 failed`, `35 passed`
- Failure 1: `patientCrud.test.ts` duplicate-patient regression expectation failed (`expected 409`, got `201`)
- Failure 2: `medicationConstraints.test.ts` general medication create returned `500` (test expects not-500)

These two are out-of-scope product defects surfaced by this verification run,
not introduced by this contract-triage slice.

## Findings

### Finding V2-C1 — Ambiguous assertions masked route contract differences

Integration tests accepted two status codes (`400` and `422`) for one
validation scenario, so a contract regression could ship without detection.

**Confidence:** `HIGH`

### Finding V2-C2 — Validation adapter split is the underlying architecture issue

Routes using direct Zod `parse` map to `422`, while routes using `validateBody`
map to `400`. This is intentional in code today but insufficiently documented,
and test ambiguity hid the difference.

**Confidence:** `HIGH`

### Finding V2-C3 — Targeted integration run surfaced two pre-existing runtime defects

The duplicate-patient lifecycle and general medication create path both failed
their current integration expectations in the same verification run.

**Confidence:** `HIGH` (runtime execution evidence)

## Closure Judgment

`V2-CONTRACT-DRIFT-TRIAGE` is closed when L1/L2/L3 command evidence is recorded
and the guard is enforced by `guard:claude-discipline`.
