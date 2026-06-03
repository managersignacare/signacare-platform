# B4 — BUG-582 Base Scheduler Abstraction Evidence (2026-05-13)

## Scope
- BUG: `BUG-582`
- Lane: `B4 — Scheduler + Alert Reliability`
- Objective: remove duplicated scheduler shell logic and make top-level scheduler safety behavior centrally enforceable.

## Structural Changes
- Added shared scheduler shell:
  - `apps/api/src/jobs/schedulers/runScheduledTick.ts`
  - Owns:
    - cron registration
    - default timezone (`Australia/Melbourne`)
    - top-level try/catch fail-loud behavior
    - shutdown hook registration (`priority: 85`)
    - structured zero-row WARN policy
    - explicit `dbAccess` posture (`dbAdmin` / `db` / `mixed`) in tick logs
- Refactored existing rule-of-three scheduler surfaces to consume shared shell:
  - `apps/api/src/jobs/schedulers/appointmentReminderScheduler.ts`
  - `apps/api/src/jobs/schedulers/referralSlaScheduler.ts`
  - `apps/api/src/jobs/schedulers/pathologyCriticalScheduler.ts`
- Preserved domain processor behavior (no algorithmic mutation):
  - Appointment reminder queueing logic unchanged.
  - Referral SLA 3-day/7-day/auto-close flow unchanged; now wrapped with canonical hourly scheduler shell.
  - Pathology critical processor unchanged; tick shell centralized.

## Regression/Compatibility Follow-up Landed In Same Slice
- Updated integration seed in:
  - `apps/api/tests/integration/bug602SchedulerCascadeRlsClose.int.test.ts`
- Reason:
  - A2 `clinics.hpio` NOT NULL enforcement made this legacy integration fixture stale.
  - Added valid HPIO value for seeded cross-tenant clinic fixture so BUG-602 regression proof stays executable.

## Verification Executed
- `npm run typecheck` => PASS
- `npm run test -- tests/unit/pathologyCriticalScheduler.test.ts -w apps/api` => PASS (39/39)
- `npm run test:integration -w apps/api -- bug602SchedulerCascadeRlsClose.int.test.ts` => PASS (2/2)
- `npm run guard:claude-discipline:ci` => PASS
- `npm run guard:timer-try-catch` => PASS

## Status
- Implementation landed (local lane work complete).
- Rollout closure pending canary + burn-in + post-burn-in verification.
