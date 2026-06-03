# B4 — BUG-577-FOLLOWUP-CONSOLIDATE-RESOLVERS Evidence (2026-05-13)

## Scope
- BUG: `BUG-577-FOLLOWUP-CONSOLIDATE-RESOLVERS`
- Lane: `B4 — Scheduler + Alert Reliability`
- Objective: remove resolver duplication between HL7-ingest and scheduler paths and converge immutable audit behavior.

## Structural Changes
- Added shared resolver SSoT:
  - `apps/api/src/shared/staffActivenessResolver.ts`
  - Provides:
    - active-recipient resolution with deterministic candidate order
    - clinic admin fallback (`nominated` then `delegated`)
    - optional no-admin fallback compatibility mode (`first_candidate`)
    - optional immutable audit emission for fallback events
- Refactored HL7-ingest critical-assignee resolution to consume shared helper:
  - `apps/api/src/features/pathology/pathologyService.ts`
  - `resolveCriticalAssigneeAdmin` now delegates to shared resolver
  - HL7 path now writes `CRITICAL_RECIPIENT_REASSIGNED` / `CRITICAL_NO_RECIPIENT_AVAILABLE` audit rows (forensic parity with scheduler path)
- Refactored pathology scheduler live context resolver to consume shared helper:
  - `apps/api/src/jobs/schedulers/pathologyCriticalScheduler.ts`
  - `buildLiveContext.resolveActiveRecipients` now delegates to shared resolver
  - Scheduler keeps existing audit ownership in `processPathologyCriticalAlerts` via `writeAuditLogRow`

## Regression Tests Added/Updated
- `apps/api/tests/integration/hl7InboundIngest.int.test.ts`
  - T8 now asserts `CRITICAL_RECIPIENT_REASSIGNED` audit row in HL7 reassignment scenario
  - T9 added: no-admin fallback scenario asserts `CRITICAL_NO_RECIPIENT_AVAILABLE` audit row and fallback-assignee metadata

## Verification Executed
- `npm run test -w apps/api -- tests/unit/pathologyCriticalScheduler.test.ts` => PASS (39/39)
- `npm run test:integration -w apps/api -- hl7InboundIngest.int.test.ts` => PASS (9/9)
- `npm run test:integration -w apps/api -- pathologyCriticalAlertsCycle2.int.test.ts` => PASS (9/9)
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## Status
- Implementation landed (local lane work complete).
- Rollout closure pending canary + burn-in + post-burn-in verification.
