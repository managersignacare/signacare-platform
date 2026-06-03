# B5 BUG-419 Evidence — Mutation Invalidation Drain (2026-05-12)

## Scope

`BUG-419` — frontend mutation invalidation gaps (`useMutation` sites missing invalidate-class behavior).

## Structural Changes Landed

1. Drained `scripts/guards/check-mutation-invalidation.allowlist` from 20 baseline entries to 0.
2. Added explicit invalidate-class handlers to state-changing mutation flows:
   - `apps/web/src/features/llm/hooks/useLLMSuggest.ts` (invalidate `llmKeys.health()` on settle)
   - `apps/web/src/features/nursing/pages/NursingPage.tsx` (handover + wound-care mutation invalidations)
   - `apps/web/src/features/power-settings/components/OnboardingWizard.tsx` (invalidate clinics list on provision)
   - `apps/web/src/features/power-settings/components/RetentionPanel.tsx` (invalidate retention on approve/revoke)
   - `apps/web/src/features/psychiatrist/pages/PsychiatristPage.tsx` (invalidate clinic-today cache on voice memo save)
   - `apps/web/src/features/reports/hooks/useReports.ts` (invalidate reports cache on generate/download)
   - `apps/web/src/features/voice/hooks/useVoiceCalls.ts` (invalidate voice cache on opt-out mutation)
3. Added explicit inline exemptions for read-only/ephemeral mutation flows:
   - password reset request/confirm
   - logout + forced change-password cache-clear flow
   - ambient draft generation
   - duplicate-check preflight
   - MFA challenge verification

## Verification

1. `npm run guard:mutation-invalidation`  
   - PASS (`allowlist=0`, `validated mutations=321`, `skipped exempt=7`)
2. `npm run lint:changed`  
   - PASS
3. `npm run typecheck`  
   - PASS
4. `npm run guard:claude-discipline:ci`  
   - PASS
5. `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts --reporter=line`  
   - PASS (57/57)

## Known Existing Probe Warnings (Pre-existing / Catalogued)

- `/calendar` -> `calendar/ical/subscribe` 404 (`BUG-718`)
- `/ai-agent` -> `outlook/status` 404 (`BUG-719`)
- Redis eviction warning text drift (`BUG-720`)
- PHI drift and React Router v7 warnings (`BUG-721`, `BUG-723`)
- `feature-flags` pre-auth 401 bootstrap noise (`BUG-724`)
