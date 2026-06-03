# Runtime Defect Pair Evidence

**Captured:** 2026-05-07  
**Scope:** local runtime remediation slice (`RUNTIME-DEFECT-DUPLICATE-PATIENT-AND-MEDICATION-500`)  
**Confidence labels:** per section

## Goal

Resolve two runtime failures found during the V2 contract-triage L4 run:

1. Duplicate patient create path not returning `409`.
2. Medication create path leaking DB trigger error as `500`.

## Root Cause Findings

### Finding R1 — duplicate scorer under-ranked exact name + DOB matches

`findDuplicateCandidates` scored exact given_name + family_name + DOB at `0.75`
(`dob_exact 0.35 + given_exact 0.2 + family_exact 0.2`), below the blocking
`strong` threshold (`0.8`).

**Confidence:** `HIGH` (source-level tracing + prior failing integration evidence)

### Finding R2 — prescribing guard bypass allowed DB trigger to surface as 500

`requirePrescribingDiscipline` returned early for admin/superadmin. In this flow,
medication create attempted insert, DB trigger rejected discipline, and response
surfaced as generic `500`.

**Confidence:** `HIGH` (source-level tracing + prior failing integration evidence)

## Changes

1. Duplicate floor for exact name + DOB:
   - [duplicateDetection.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/patients/duplicateDetection.ts)
   - Exact `given_name + family_name + DOB` now promotes candidate score to at least `STRONG_THRESHOLD` and tags `name_dob_exact`.
2. Prescribing discipline bypass removed:
   - [authGuards.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/shared/authGuards.ts)
   - `requirePrescribingDiscipline` now applies to all roles.
3. Integration expectation updated for prescribing guard denial:
   - [medicationConstraints.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/integration/medicationConstraints.test.ts)
   - Accepts `403` as valid safety-gate outcome and still fails on `500`.

## Local Verification

### L1

- `npx eslint apps/api/src/features/patients/duplicateDetection.ts apps/api/src/shared/authGuards.ts apps/api/tests/integration/medicationConstraints.test.ts` — **PASS**

### L3

- `cd apps/api && npx vitest run --config vitest.config.ts tests/unit/duplicateDetection.test.ts` — **PASS** (`7/7`)

### L4

- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/patientCrud.test.ts tests/integration/medicationConstraints.test.ts` — **PASS** (`20/20`)
- Runtime proof points:
  - duplicate create second request now returns `409` (`/api/v1/patients`)
  - medication create with admin caller now returns `403`, not `500` (`/api/v1/medications`)

## Closure Judgment

Both runtime defects are locally resolved with integration proof.
