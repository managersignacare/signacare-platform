# B4 Evidence — BUG-592 Follow-ups (Phenytoin + Threshold Guards)

## Scope

- `BUG-592-FOLLOWUP-PHENYTOIN`
- `BUG-592-FOLLOWUP-THRESHOLD-FLOOR`

Date: `2026-05-13`  
Lane: `B4 — Scheduler and Alert Reliability Framework`  
Status: `implementation landed (repo-level); rollout closure pending`

## Structural Changes

1. Added phenytoin as a first-class monitored drug in the canonical therapeutic-level config:
   - `apps/api/src/features/prescriptions/therapeuticLevelHelpers.ts`
   - pattern: `/\b(phenytoin|dilantin|epanutin)\b/i`
   - test codes: `['phenytoin', 'phen', '3968-5']`
   - default threshold key: `therapeutic_level_phenytoin_days`

2. Added per-clinic default threshold key:
   - `apps/api/src/features/settings/settingsService.ts`
   - `therapeutic_level_phenytoin_days: 90`

3. Enforced therapeutic threshold guardrails in canonical service-level validation:
   - `apps/api/src/features/settings/settingsService.ts`
   - `THRESHOLD_FLOORS` now includes:
     - lithium/valproate/carbamazepine/phenytoin: `min=1`, `max=180`
     - warfarin: `min=1`, `max=28`

4. Updated scheduler commentary/docs to reflect five monitored classes:
   - `apps/api/src/jobs/schedulers/therapeuticLevelMonitoringScheduler.ts`

## Test Evidence

### Unit

- `cd apps/api && npx vitest run tests/unit/therapeuticLevelMonitoringScheduler.test.ts`
- Result: PASS (`30/30`)
- Added/updated assertions:
  - config now includes `phenytoin`
  - phenytoin brand matching (`Dilantin`, `Epanutin`)
  - multi-clinic invocation count updated for 5-class walk (`10` calls for 2 clinics)

### Integration (Live scheduler + guardrails)

- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/therapeuticLevelMonitoringSchedulerCycle2.int.test.ts tests/integration/therapeuticLevelThresholdGuards.int.test.ts`
- Result: PASS (`12/12`)
- New coverage:
  - `TP-TL-INT-592-4b`: phenytoin overdue alert via LOINC `3968-5`
  - `TP-TL-THR-592-1..5`: threshold ceiling/floor enforcement and boundary acceptance

### Lane checks

- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## Bug Closure Notes

- These two follow-up bugs are now **fixed in-repo**.
- Per program contract, final closure still requires rollout evidence:
  - canary
  - burn-in
  - post-burn-in verification
