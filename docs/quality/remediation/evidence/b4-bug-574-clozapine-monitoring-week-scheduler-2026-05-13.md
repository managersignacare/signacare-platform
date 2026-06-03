# B4 BUG-574 Evidence — Clozapine Monitoring-Week Scheduler

- Date: 2026-05-13
- Lane: B4 (Scheduler and Alert Reliability Framework)
- Bug: `BUG-574`
- Scope: add monitoring-week scheduler for clozapine week 1..18 review points, with fail-visible recipient fallback and immutable audit evidence.

## Implementation Artifacts

- `apps/api/src/jobs/schedulers/clozapineMonitoringWeekScheduler.ts`
- `apps/api/src/jobs/bootstrap.ts`
- `apps/api/src/utils/audit.ts`
- `apps/api/tests/unit/clozapineMonitoringWeekScheduler.test.ts`
- `apps/api/tests/integration/clozapineMonitoringWeekScheduler.int.test.ts`
- `docs/quality/fix-registry.md`
- `docs/quality/bugs-remaining.md`
- `docs/quality/remediation/active-slice.md`

## Schema-Truth Decisions

1. BUG text referenced a monitoring-week schedule but not a canonical due-date column.
2. Implementation uses `clozapine_registrations.next_blood_due_date` as reminder axis and `monitoring_week` bounded to `1..18`.
3. This keeps BUG-574 distinct from BUG-569 (`overdue-only`) and avoids non-existent-field assumptions.

## Verification Commands

- `npm run lint:changed`  
  Result: PASS (`lint:changed (workspace) — linting 5 file(s)`; no violations)
- `npm run typecheck`  
  Result: PASS (root workspace typecheck chain exited 0)
- `npm run guard:claude-discipline:ci`  
  Result: PASS (all discipline + C3/A2 structural guards green)
- `cd apps/api && npx vitest run tests/unit/clozapineMonitoringWeekScheduler.test.ts`  
  Result: PASS (`1/1` file, `12/12` tests)
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/clozapineMonitoringWeekScheduler.int.test.ts`  
  Result: PASS (`1/1` file, `5/5` tests)

## L5 Notes

1. BUG-574 is implementation-complete in-repo with deterministic L1-L4 evidence.
2. Closure remains rollout-gated: canary + burn-in + post-burn-in verification are still required before marking BUG-574 fully closed.
