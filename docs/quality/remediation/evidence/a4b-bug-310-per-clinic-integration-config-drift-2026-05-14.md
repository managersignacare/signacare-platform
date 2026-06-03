# A4b BUG-310 Local Evidence — Per-Clinic Integration-Config Drift Detection

**Date:** 2026-05-14  
**Lane:** A4b (Security / Privacy / Observability)  
**BUG:** `BUG-310`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. New drift-check module:
   - `apps/api/src/shared/perClinicIntegrationConfigDrift.ts`
   - Exposes:
     - `evaluatePerClinicIntegrationConfigDrift(...)`
     - `runPerClinicIntegrationConfigDriftCheck(...)`
     - `schedulePerClinicIntegrationConfigDriftCheck(...)`
2. Auth lifecycle wiring:
   - `apps/api/src/middleware/authMiddleware.ts`
   - Schedules per-clinic drift check for admin/superadmin once auth context is established.
3. Drift conditions now fail-visible:
   - Feature flag `integration-mhr-docref` ON but required MHR runtime config missing.
   - Feature flag `integration-radiology-hl7` ON but required HL7 runtime config missing.
   - Feature flag `integration-healthlink` ON but required HealthLink runtime config missing.
   - Clinic `hpio` missing while eRx runtime is configured.
   - Clinic `npds_conformance_id` missing while NPDS runtime is configured.
4. Detection emits operational evidence:
   - audit action `CLINIC_INTEGRATION_CONFIG_DRIFT`
   - admin alert kind `integration_config_drift`
   - warning notification fanout (`sse` + `bell`)
5. Contract extensions:
   - `apps/api/src/utils/audit.ts` adds `CLINIC_INTEGRATION_CONFIG_DRIFT`
   - `apps/api/src/features/patient-outreach/adminAlert.ts` adds `integration_config_drift`
6. Regression coverage:
   - `apps/api/tests/unit/bug310PerClinicIntegrationConfigDrift.test.ts` (5 tests)

## Local Verification

1. `npm run test -w apps/api -- tests/unit/bug310PerClinicIntegrationConfigDrift.test.ts` => PASS (`5/5`)
2. `npm run lint:changed` => PASS
3. `npm run typecheck` => PASS
4. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Run canary proof with one intentional clinic mismatch and one corrected replay; capture alert + audit evidence.
2. Complete burn-in and post-burn-in verification per lane contract.
3. Flip catalogue row only after rollout evidence packet is attached.
