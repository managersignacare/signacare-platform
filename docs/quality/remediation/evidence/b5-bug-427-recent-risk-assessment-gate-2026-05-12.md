# B5 Evidence — BUG-427 Recent Risk Assessment Gate (2026-05-12)

## Scope

- Lane: `B5`
- Bug: `BUG-427`
- Goal: block signing first psychiatric encounter note for new patients when no risk assessment was completed in the last 48 hours.

## Implementation Summary

1. Added shared BUG-427 contract constants for gated note types and 48-hour window.
2. Added feature flag key `b5-recent-risk-assessment-bypass` (default off).
3. Added backend policy + evaluator:
   - `apps/api/src/shared/recentRiskAssessmentPolicy.ts`
   - `apps/api/src/shared/recentRiskAssessmentGate.ts`
4. Wired fail-closed backend enforcement to all active sign surfaces:
   - `POST /patients/:id/notes` create-sign path
   - `PATCH /patients/:id/notes/:noteId` draft-sign path
   - `POST /clinical-notes/:id/sign` service path
5. Added frontend pre-check + sign guidance in AddNoteDialog and mapped backend code in NoteSignModal.
6. Added deterministic tests:
   - integration: `apps/api/tests/integration/bug427RecentRiskAssessmentGate.int.test.ts`
   - utility unit: `apps/web/src/shared/utils/recentRiskAssessment.test.ts`

## Guard And Test Results

- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `npx vitest run src/shared/utils/recentRiskAssessment.test.ts` (apps/web) => PASS (5/5)
- `npm run test:integration -w apps/api -- tests/integration/bug427RecentRiskAssessmentGate.int.test.ts` => PASS (5/5)
- `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts --reporter=line` => PASS (57/57)

## L5 Probe Notes (Catalogued Noise)

- `/calendar` emits `calendar/ical/subscribe` 404 console errors (`BUG-718`).
- `/ai-agent` emits `outlook/status` 404 console errors (`BUG-719`).
- React Router v7 future-flag warning still present (`BUG-723`).
- Pre-auth `feature-flags` 401 startup noise still present (`BUG-724`).

## Closure State

- `BUG-427` implementation: complete-in-repo.
- Rollout closure contract still pending: canary + burn-in + post-burn-in verification.
