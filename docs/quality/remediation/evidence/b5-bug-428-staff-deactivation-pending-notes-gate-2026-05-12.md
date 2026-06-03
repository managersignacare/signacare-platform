# B5 Evidence — BUG-428 Staff Deactivation Pending-Notes Gate (2026-05-12)

## Scope

- Lane: `B5`
- Bug: `BUG-428`
- Goal: block staff deactivation while authored unsigned draft clinical notes remain, with an actionable rejection contract.

## Implementation Summary

1. Added shared feature flag key:
   - `b5-staff-deactivation-pending-notes-bypass` (default off)
2. Added backend policy evaluator:
   - `apps/api/src/shared/staffDeactivationPendingNotesPolicy.ts`
3. Added repository support for deterministic pending-note detection:
   - `countPendingUnsignedNotesByAuthor()`
   - `listPendingUnsignedNotesByAuthor()`
4. Wired fail-closed guard at the staff update service boundary:
   - `apps/api/src/features/staff/staffService.ts`
   - guard applies only on deactivation transition (`true -> false`)
   - emits `409 STAFF_DEACTIVATION_BLOCKED_PENDING_UNSIGNED_NOTES` with structured details
5. Threaded auth context into update controller:
   - `apps/api/src/features/staff/staffController.ts`
6. Added deterministic integration proof:
   - `apps/api/tests/integration/bug428StaffDeactivationPendingNotesGate.int.test.ts`

## Guard And Test Results

- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `npm run test:integration -w apps/api -- tests/integration/bug428StaffDeactivationPendingNotesGate.int.test.ts` => PASS (3/3)
- `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts --reporter=line` => PASS (57/57)

## L5 Probe Notes (Catalogued Noise)

- `/calendar` emits `calendar/ical/subscribe` 404 console errors (`BUG-718`).
- `/ai-agent` emits `outlook/status` 404 console errors (`BUG-719`).
- React Router v7 future-flag warning still present (`BUG-723`).
- Pre-auth `feature-flags` 401 startup noise still present (`BUG-724`).
- `pg` concurrent `client.query()` deprecation warning still present (`BUG-722`).

## Closure State

- `BUG-428` implementation: complete-in-repo.
- Rollout closure contract pending: canary + burn-in + post-burn-in verification.
