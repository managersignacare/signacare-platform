# B4 — BUG-577-FOLLOWUP-CLINIC-BOOTSTRAP-ADMIN-CHECK Evidence (2026-05-13)

## Scope
- BUG: `BUG-577-FOLLOWUP-CLINIC-BOOTSTRAP-ADMIN-CHECK`
- Lane: `B4 — Scheduler + Alert Reliability`
- Objective: add preventive alerting so clinics with both admin slots unset are surfaced before a runtime critical-alert fallback event.

## Structural Changes
- Creation-time prevention:
  - `apps/api/src/features/clinic/clinicService.ts`
  - `createClinic` now emits non-blocking `sendAdminAlert(kind='clinic_admin_slots_unconfigured')` when both admin slots are unset.
- Startup/bootstrap sweep for existing clinics:
  - Added `apps/api/src/jobs/schedulers/clinicAdminSlotBootstrapCheck.ts`
  - Processor shape:
    - `processClinicAdminSlotBootstrapCheck(now, ctx)` (pure orchestration)
    - `buildLiveContext()` (`dbAdmin` clinic scan + recent-alert dedupe lookup)
    - `runClinicAdminSlotBootstrapCheck()` (live runner)
  - Deduplication contract:
    - skip emit when same clinic has an `ADMIN_ALERT` for `clinic_admin_slots_unconfigured` in prior 24h
  - Startup hook:
    - `apps/api/src/jobs/bootstrap.ts` executes check non-blockingly from `startSchedulers()`, with structured completion/error logs.
- Admin alert kind extension:
  - `apps/api/src/features/patient-outreach/adminAlert.ts`
  - Added `clinic_admin_slots_unconfigured`.

## Regression Tests
- `apps/api/tests/unit/clinicService.test.ts`
  - emits on missing slots
  - suppressed when any admin slot is configured
  - create flow remains non-blocking on alert-dispatch failure
- `apps/api/tests/unit/clinicAdminSlotBootstrapCheck.test.ts`
  - list-failure isolation path
  - empty-clinic fast path
  - 24h dedupe + per-clinic error isolation behavior

## Verification Executed
- `npm run test -w apps/api -- tests/unit/clinicAdminSlotBootstrapCheck.test.ts tests/unit/clinicService.test.ts tests/unit/pathologyCriticalScheduler.test.ts` => PASS (`45/45`)
- `npm run test:integration -w apps/api -- hl7InboundIngest.int.test.ts pathologyCriticalAlertsCycle2.int.test.ts` => PASS (`9/9`, `9/9`)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## Status
- Implementation landed (local lane work complete).
- Rollout closure pending canary + burn-in + post-burn-in verification.
