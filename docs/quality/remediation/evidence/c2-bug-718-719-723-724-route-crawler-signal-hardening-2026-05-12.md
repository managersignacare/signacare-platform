# C2 Evidence — BUG-718 / BUG-719 / BUG-723 / BUG-724 Route-Crawler Signal Hardening (2026-05-12)

## Scope

- Lane: `C2` (runtime honesty probes + environment fidelity)
- Bugs addressed in this slice:
  - `BUG-718` (`/calendar` probe 404 noise from `GET /calendar/ical/subscribe`)
  - `BUG-719` (`/ai-agent` probe 404 noise from `GET outlook/status`)
  - `BUG-723` (React Router `v7_startTransition` warning spam)
  - `BUG-724` (pre-auth `feature-flags` 401 bootstrap noise)

## Root Causes and Fixes

1. `BUG-718` route precedence bug:
   - Public iCal route over-matched (`/:clinicianIdIcs`) and shadowed authenticated `/subscribe`.
   - Fix: constrain public route matcher to `/:clinicianId([0-9a-fA-F-]{8,}).ics` and consume canonical `clinicianId` param only.

2. `BUG-719` endpoint contract drift:
   - AiAgent page called legacy `outlook/status`.
   - Fix: point to mounted backend endpoint `integrations/outlook/status`.

3. `BUG-723` future-flag application drift:
   - `v7_startTransition` must be set on render future config (`RouterProvider`), not router-init future config (`createBrowserRouter`).
   - Fix: keep `future={{ v7_startTransition: true }}` on `RouterProvider`; remove unsupported router-init key.

4. `BUG-724` pre-auth bootstrap noise:
   - Feature-flag query fired before authenticated state was established.
   - Fix: gate query execution with `enabled: isAuthenticated` and split query key by auth posture.

## Files Changed

- `apps/api/src/features/calendar/calendarIcalPublicRoutes.ts`
- `apps/api/tests/integration/bug718CalendarSubscribeRoute.int.test.ts`
- `apps/web/src/features/ai-agent/pages/AiAgentPage.tsx`
- `apps/web/src/shared/hooks/useFeatureFlag.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/router.tsx`
- `docs/quality/remediation/active-slice.md`
- `docs/quality/bugs-remaining.md`

## Verification (Same Session)

1. `npm run typecheck` => PASS
2. `npm run lint:changed` => PASS
3. `npm run guard:claude-discipline:ci` => PASS
4. `npm run test:integration -w apps/api -- tests/integration/bug718CalendarSubscribeRoute.int.test.ts` => PASS (1/1)
5. `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts --grep "route /dashboard|route /calendar|route /ai-agent" --reporter=line` => PASS (3/3)
6. `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts --reporter=line` => PASS (57/57)

## Residual Warnings Observed (Tracked, Not Fixed In This Slice)

- `BUG-720`: BullMQ Redis eviction-policy warning text mismatch (`allkeys-lru` vs expected `noeviction` string in dependency internals).
- `BUG-721`: PHI classifier drift warning (`[BUG-216 drift] ... not in PHI_FIELDS`).
- `BUG-722`: `pg` deprecation warning (`client.query()` while already executing query).

All residual warnings remain explicitly tracked in `docs/quality/bugs-remaining.md` and `docs/quality/remediation/active-slice.md`.
