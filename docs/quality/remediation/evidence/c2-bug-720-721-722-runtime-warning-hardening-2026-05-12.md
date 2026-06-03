# C2 Evidence — BUG-720 / BUG-721 / BUG-722 Runtime Warning Hardening (2026-05-12)

## Scope

- Lane: `C2` (runtime honesty probes + environment fidelity)
- Bugs addressed in this slice:
  - `BUG-720` (BullMQ Redis policy warning contradicting canonical `allkeys-lru`)
  - `BUG-721` (PHI classifier drift warning on unmapped columns)
  - `BUG-722` (`pg` concurrent `client.query()` deprecation warning under RLS request flow)

## Root Causes and Fixes

1. `BUG-720` dependency warning mismatch:
   - BullMQ emits a static warning when Redis policy is not `noeviction`, even though platform policy is intentionally `allkeys-lru` (BUG-708 posture).
   - Fix: install targeted startup warning policy filter (`installBullmqEvictionWarningPolicy`) that suppresses only this known BullMQ string when policy is `allkeys-lru`; all other warnings continue unchanged.

2. `BUG-721` PHI taxonomy drift:
   - Logger drift check surfaced 31 schema columns missing from PHI field categories.
   - Fix: classify and add all surfaced columns to `PHI_FIELDS` category sets, then add regression assertions in `loggerRedaction.test.ts` to prove redaction coverage.

3. `BUG-722` architectural query-flow issue:
   - Request-scoped RLS binds each request to one transaction connection; `Promise.all` DB fan-out within a request triggers pg concurrent-query deprecation and future pg@9 break risk.
   - Structural fix: remove DB fan-out `Promise.all` patterns from runtime request paths and execute DB query bundles sequentially across affected surfaces (`calendar`, `dashboard`, `notifications`, `staff/me`, `reports`, `cross-role`, `nurse handover`, `clinical-review`, `duplicate-merge`, `llm usage summary`).
   - Rejected approach: transaction-client query serializer in middleware (caused transactional lifecycle regression and was removed).

## Files Changed

- `apps/api/src/shared/installBullmqEvictionWarningPolicy.ts`
- `apps/api/src/server.ts`
- `apps/api/src/utils/phiFields.ts`
- `apps/api/tests/unit/loggerRedaction.test.ts`
- `apps/api/src/middleware/rlsMiddleware.ts` (rollback of unsafe serializer patch)
- `apps/api/src/features/calendar/calendarService.ts`
- `apps/api/src/features/dashboard/dashboardService.ts`
- `apps/api/src/features/notifications/notificationRoutes.ts`
- `apps/api/src/features/staff/staffRoutes.ts`
- `apps/api/src/features/reports/reportsRoutes.ts`
- `apps/api/src/features/roles/crossRoleFeatureRoutes.ts`
- `apps/api/src/features/roles/nurseFeatureRoutes.ts`
- `apps/api/src/features/clinical-review/clinicalReviewService.ts`
- `apps/api/src/features/contacts/contactRecordRoutes.ts`
- `apps/api/src/features/patients/duplicateRoutes.ts`
- `apps/api/src/features/llm/llmService.ts`
- `docs/quality/remediation/active-slice.md`
- `docs/quality/bugs-remaining.md`

## Verification (Same Session)

1. `npm run lint:changed` => PASS
2. `npm run typecheck` => PASS
3. `npm run guard:claude-discipline:ci` => PASS
4. `npm run test -w apps/api -- tests/unit/loggerRedaction.test.ts` => PASS (9/9)
5. `npm run test:integration -w apps/api -- bug718CalendarSubscribeRoute.int.test.ts c3NonCriticalBackfillBatch1.int.test.ts` => PASS
6. `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts --grep "route /dashboard|route /calendar|route /reports" --reporter=line` => PASS (3/3)
7. `NODE_OPTIONS='--trace-warnings' npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts --reporter=line` => PASS (57/57)

## Runtime Signal Result

- `BUG-720` BullMQ stale policy warning string: no longer emitted in probe output.
- `BUG-721` `[BUG-216 drift] ... not in PHI_FIELDS`: no longer emitted in probe output.
- `BUG-722` pg deprecation warning (`client.query() while already executing query`): no longer emitted in probe output.

## Residual Follow-Up (Tracked)

- `BUG-717` (`ERR_HTTP_HEADERS_SENT` on `/audit`) remains explicitly open and outside this slice’s closure set.
- Rollout closure contract still applies (canary, burn-in, post-burn-in verification) before final state transition from `open` to `fixed`.
