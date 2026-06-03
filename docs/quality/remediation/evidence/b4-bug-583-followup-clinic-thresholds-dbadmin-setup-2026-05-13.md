# B4 — BUG-583-FOLLOWUP-CLINIC-THRESHOLDS-DBADMIN-SETUP Evidence (2026-05-13)

## Scope
- BUG: `BUG-583-FOLLOWUP-CLINIC-THRESHOLDS-DBADMIN-SETUP`
- Lane: `B4 — Scheduler + Alert Reliability`
- Objective: remove test-side threshold override and validate live per-clinic threshold lookup path.

## Structural Changes
- Updated `apps/api/tests/integration/pathologyCriticalAlertsCycle2.int.test.ts`:
  - removed TP-PA-INT-578-1 test-side context override (`getEscalationThreshold: async () => 30`)
  - added helper `seedClinicEscalationThresholdForTest(clinicId, thresholdMinutes)` that:
    - upserts `clinic_thresholds` row with `threshold_key='pathology_escalation_minutes'` via `dbAdmin`
    - returns a restorer that restores prior row state in `finally`
  - TP-PA-INT-578-1 now runs with `await buildLiveContext()` and asserts dynamic `30min+` escalation label using live scheduler lookup.
- Updated `apps/api/tests/integration/hl7InboundIngest.int.test.ts`:
  - T8 expectation now derives expected reassigned admin from the currently configured clinic slots (`nominated` first, `delegated` fallback), matching shared resolver SSoT behavior.

## Why This Closes The Local Gap
- The test now exercises production lookup (`settingsService.getThresholds(..., dbAdmin)`) and real key resolution (`pathology_escalation_minutes`) instead of bypassing with a wrapper override.
- Threshold state restoration prevents test pollution across suites that share the seed clinic.

## Verification Executed
- `npm run test:integration -w apps/api -- pathologyCriticalAlertsCycle2.int.test.ts` => PASS (9/9)
- `npm run test:integration -w apps/api -- hl7InboundIngest.int.test.ts` => PASS (9/9)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## Status
- Implementation landed (local lane work complete).
- Rollout closure pending canary + burn-in + post-burn-in verification.
