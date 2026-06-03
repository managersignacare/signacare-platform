# B4 Evidence — BUG-589/592 Tier-2 Escalation Follow-Ups

**Date:** 2026-05-12  
**Lane:** B4 (Scheduler and Alert Reliability Framework)  
**Scope:** `BUG-589-FOLLOWUP-TIER-2-ESCALATION`, `BUG-592-FOLLOWUP-TIER-2-ESCALATION`

## Intent

Close remaining silent-drop recurrence in prescription-repeat and therapeutic-level schedulers when tier-1 recipients are unavailable.

## Structural Changes

1. Added tier-2 escalation fallback in:
   - `apps/api/src/jobs/schedulers/prescriptionRepeatScheduler.ts`
   - `apps/api/src/jobs/schedulers/therapeuticLevelMonitoringScheduler.ts`
2. Added per-clinic escalation threshold defaults:
   - `prescription_repeat_escalation_minutes` (default `30`)
   - `therapeutic_level_escalation_minutes` (default `30`)
   in `apps/api/src/features/settings/settingsService.ts`.
3. Added tier-2 dedupe namespaces and threshold predicates:
   - `prescription-repeat-escalation:*:fired-day:*`
   - `therapeutic-level-escalation:*:fired-day:*`
4. Extended unit/integration tests to prove no-recipient branch now escalates.

## Verification

### L1

- `npm run -s lint:changed` => PASS
- `npm run -s typecheck` => PASS

### L2

- `npm run -s guard:claude-discipline:ci` => PASS

### L4

- `cd apps/api && npm run test -- tests/unit/prescriptionRepeatScheduler.test.ts tests/unit/therapeuticLevelMonitoringScheduler.test.ts` => PASS (`68/68`)
- `cd apps/api && npm run test:integration -- prescriptionRepeatSchedulerCycle2.int.test.ts therapeuticLevelMonitoringSchedulerCycle2.int.test.ts` => PASS (`6/6` + `6/6`)

## Result

Both B4 follow-up S1 rows are closed in the canonical bug ledger; tier-1 no-recipient paths now remain fail-visible and fail-notifying (tier-2), not fail-silent.
