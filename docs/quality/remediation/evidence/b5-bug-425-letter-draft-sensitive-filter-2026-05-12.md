# B5 Evidence — BUG-425 Letter Draft Sensitive-Field Filter

**Date:** 2026-05-12  
**Lane:** B5 (Frontend truthfulness / letter draft safety contract)  
**Bug:** `BUG-425`  
**Status:** implementation complete in repo; rollout closure pending

## Problem

AI-generated letter drafts returned from `/api/v1/llm/clinical-ai` had no downstream safety filter for identifier/contact leakage, creating a cross-patient/cross-clinic leakage class at the output boundary.

## Architectural Remediation

1. Added a dedicated downstream safety filter:
   - `apps/api/src/features/llm/letterDraftSafety.ts`
   - strips high-risk lines in letter body output (DOB/UR/MRN/Medicare/IHI/email/phone/address/header/sign-off markers)
2. Enforced the contract in both letter generation modes in `llmRoutes.ts`:
   - enhanced path (`enhancedGenerate`)
   - direct path (`localLlmAgent.generateLetter`)
3. Added fail-closed behavior:
   - `action='letter'` now requires `patientId`; missing value returns `400 VALIDATION_ERROR`.
4. Added emergency bypass control (default OFF):
   - shared flag constant: `b5-letter-draft-sensitive-filter-bypass`
   - registry entry: `docs/quality/remediation/feature-flag-registry.md`
5. Updated caller alignment:
   - `AddNoteDialog.tsx` now sends `patientId` and keeps direct generation path (`enhance: false`) so the new backend safety contract is satisfied.

## Files Changed

- `apps/api/src/features/llm/llmRoutes.ts`
- `apps/api/src/features/llm/letterDraftSafety.ts`
- `apps/api/tests/unit/letterDraftSafety.test.ts`
- `apps/api/tests/integration/bug425LetterSensitiveFilter.int.test.ts`
- `apps/web/src/features/patients/components/notes/AddNoteDialog.tsx`
- `packages/shared/src/featureFlag.constants.ts`
- `docs/quality/remediation/feature-flag-registry.md`
- `docs/quality/bugs-remaining.md`
- `docs/quality/remediation/active-slice.md`

## Verification (Same Session)

- `cd apps/api && npx vitest run tests/unit/letterDraftSafety.test.ts` => PASS (3/3)
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/bug425LetterSensitiveFilter.int.test.ts` => PASS (3/3)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts --reporter=line` => PASS (57/57)

## Residual / Handoff

- `BUG-425` remains open until rollout contract completes (canary + burn-in + post-burn-in verification).
- Probe-noise siblings observed in same run are catalogued for follow-up: `BUG-718`, `BUG-719`, `BUG-720`, `BUG-721`, `BUG-722`, `BUG-723`, `BUG-724`.
