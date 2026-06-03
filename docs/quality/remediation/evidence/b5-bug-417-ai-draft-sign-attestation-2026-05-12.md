# B5 BUG-417 — AI-Draft Sign Attestation Evidence (2026-05-12)

## Scope

Lane: `B5`  
Primary bug: `BUG-417`

## Root-Cause Class

AI-drafted notes could be signed without an explicit, auditable clinician attestation step, and enforcement was inconsistent across sign paths.

## Structural Fix Implemented

1. Added canonical shared feature-flag key:
   - `b5-ai-draft-sign-attestation-bypass` (emergency kill switch)
2. Added shared backend policy evaluator:
   - `shouldEnforceAiDraftSignAttestation(auth)`
3. Enforced fail-closed sign contract for AI-draft notes in both APIs:
   - `POST /clinical-notes/:id/sign`
   - `POST /patients/:id/notes` (signed create) and `PATCH /patients/:id/notes/:noteId` (signed transition)
4. Added explicit frontend attestation checkbox in all active sign UIs:
   - clinical-notes sign modal
   - AddNoteDialog save-and-sign path
   - NotesList sign flow
5. Added test coverage for bypass resistance:
   - integration test validating 409 reject without attestation and success with attestation
   - web unit test validating shared attestation gating helper

## Verification (same session)

1. `npm run typecheck`  
   - PASS
2. `npm run lint:changed`  
   - PASS
3. `npm run guard:claude-discipline:ci`  
   - PASS
4. `cd apps/web && npx vitest run src/shared/utils/aiDraftSignAttestation.test.ts`  
   - PASS
5. `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/bug417AiDraftSignAttestation.int.test.ts`  
   - PASS
6. `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts --reporter=line`  
   - PASS

## Closure Posture

- BUG-417 implementation and local gate verification are complete in-repo.
- Rollout closure remains pending canary + burn-in + post-burn-in rerun under program governance.

