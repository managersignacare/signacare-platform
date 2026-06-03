# CSR-8 Controlled Demo-Data Reset + Smoke Replay (2026-05-15)

## Scope

Pre-deployment CSR-8 execution for controlled reset/readiness only (no Phase-B canary/burn-in claims).

## Root-Cause Gap Closed During CSR-8

Observed blocker:

1. `DEMO_SEED=good-health DEMO_WIPE=1` failed with:
   - `duplicate key value violates unique constraint "uq_clinical_roles_clinic_id_name"`
   - conflict on `(clinic_id, name)` for `clinical_roles`.

Structural fix:

1. Updated [00_reference_data.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/seed-good-health/generators/00_reference_data.ts) to reconcile by natural keys first (preserving existing row IDs), then deterministic ID fallback.
2. Added regression test:
   - [seedGoodHealthReferenceDataNaturalKey.int.test.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/tests/integration/seedGoodHealthReferenceDataNaturalKey.int.test.ts)
   - proves legacy-ID + natural-key collision does not reintroduce duplicate insert failure.

## Pre-Reset Checkpoint

1. Schema snapshot refresh:
   - `npm run db:snapshot -w apps/api`
   - `Tables: 246`, `Columns: 3450`, `FKs: 719`
2. Schema fingerprint:
   - `bfaa9cb00d5518d82f2cacf473429c24cf9d0c0c8d70b4eb052f27e797b0d38b`
3. Baseline row counts (tracked before/after reset):
   - `patients=3183`
   - `staff=876`
   - `episodes=1274`
   - `clinical_notes=2024`
   - `patient_medications=425`
   - `appointments=1`
   - `referrals=27`
   - `audit_log=252261`

## Reset + Seed Execution

1. `DEMO_SEED=good-health DEMO_WIPE=1 npm run seed:good-health -w apps/api` PASS
   - `inserted=11525`, `updated=4887`
2. `npm run seed:canonical-personas -w apps/api` PASS
   - `9 personas upserted`
3. `npm run seed:e2e-fixtures -w apps/api` PASS
   - deterministic fixtures refreshed across 2 clinics.

## Readiness Verification (Post-Reset)

1. `npm run typecheck` PASS.
2. `npm run guard:all` PASS.
3. Workflow smoke integration pack PASS:
   - `clinicAccessAdminsPowerSettings.int`
   - `clinicAccessAdminsSchema.int`
   - `patientCrud`
   - `episodeStateMachine`
   - `bug415ReferralStateMachine.int`
   - `prescribingSafety`
   - `laiAlertScheduler.int`
   - `bug425LetterSensitiveFilter.int`
   - `clinicalNotesConsentFK.int`
4. New seed-collision regression proof PASS:
   - `seedGoodHealthReferenceDataNaturalKey.int`
5. Provisioning onboarding regression proof PASS:
   - `provisioningOnboarding.int`
   - verifies:
     - formatted HPI-O input is accepted and normalized (`800362-1234 567890` -> `8003621234567890`),
     - invalid HPI-O is fail-closed as `422 VALIDATION_ERROR`,
     - duplicate admin email returns `409 CONFLICT` (not `500 INTERNAL_ERROR`).

## Verdict

CSR-8 local objective is achieved:

1. Controlled reset path is deterministic and no longer fails on legacy natural-key collisions.
2. Core post-reset smoke/readiness checks are green, including provisioning onboarding edge paths.
3. Lane posture remains Phase-A complete; Phase-B deployment evidence is still pending by design.
