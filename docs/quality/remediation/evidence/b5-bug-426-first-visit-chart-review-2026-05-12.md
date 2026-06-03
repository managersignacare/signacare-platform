# B5 Evidence — BUG-426 First-Visit Chart Review Gate

**Date:** 2026-05-12  
**Lane:** B5 (Frontend truthfulness / first-visit sign safety contract)  
**Bug:** `BUG-426`  
**Status:** implementation complete in repo; rollout closure pending

## Problem

On first encounter note sign, clinicians could complete signing without an explicit chart-review checkpoint for recent labs, imaging, and medications.

## Architectural Remediation

1. Added shared first-visit chart-review contract in note DTO:
   - `packages/shared/src/clinicalNote.Schemas.ts`
   - `firstVisitChartReview` attestation schema (all three review flags required true)
   - shared gated note-type list (`progress`, `intake`, `review`, `ward_round`)
2. Added backend policy + enforcement at sign boundary:
   - `apps/api/src/shared/firstVisitChartReviewPolicy.ts`
   - `apps/api/src/features/patients/firstVisitChartReviewAttestation.ts`
   - enforced on:
     - `POST /patients/:id/notes` when `status='signed'`
     - `PATCH /patients/:id/notes/:noteId` when signing a draft
3. Added fail-closed response:
   - `409 FIRST_VISIT_CHART_REVIEW_REQUIRED` when first signed encounter note is missing valid attestation.
4. Persisted attestation audit evidence on note:
   - `clinical_notes.contact_meta.firstVisitChartReview` includes reviewed axes, reviewer staff id, and timestamp.
5. Added emergency bypass control (default OFF):
   - shared flag constant: `b5-first-visit-chart-review-bypass`
   - registry entry: `docs/quality/remediation/feature-flag-registry.md`
6. Updated AddNoteDialog sign flow:
   - first-visit warning + required checkbox set (labs, imaging, medications)
   - Save & Sign disabled until all three are checked when gate applies
   - signed payload carries `firstVisitChartReview` attestation.
7. Cross-gate deterministic test hardening (same-day refresh):
   - `bug426` integration fixture now seeds a recent risk assessment for first-sign scenarios so chart-review behavior is asserted with `BUG-427` gate active.
   - prevents false failures from precondition drift and keeps gate proof truthful.

## Files Changed

- `packages/shared/src/clinicalNote.Schemas.ts`
- `packages/shared/src/featureFlag.constants.ts`
- `apps/api/src/shared/firstVisitChartReviewPolicy.ts`
- `apps/api/src/features/patients/firstVisitChartReviewAttestation.ts`
- `apps/api/src/features/patients/patientRoutes.ts`
- `apps/api/tests/integration/bug426FirstVisitChartReviewGate.int.test.ts`
- `apps/web/src/features/patients/components/notes/AddNoteDialog.tsx`
- `docs/quality/remediation/feature-flag-registry.md`
- `docs/quality/bugs-remaining.md`
- `docs/quality/remediation/active-slice.md`

## Verification (Same Session)

- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `npm run test:integration -w apps/api -- tests/integration/bug426FirstVisitChartReviewGate.int.test.ts` => PASS (3/3)
- `npm run test:integration -w apps/api -- tests/integration/bug425LetterSensitiveFilter.int.test.ts tests/integration/bug426FirstVisitChartReviewGate.int.test.ts tests/integration/bug427RecentRiskAssessmentGate.int.test.ts tests/integration/bug428StaffDeactivationPendingNotesGate.int.test.ts` => PASS (all 4 files)
- `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts --reporter=line` => PASS (57/57)

## Residual / Handoff

- `BUG-426` remains open until rollout contract completes (canary + burn-in + post-burn-in verification).
- Known probe-noise siblings remain catalogued and unchanged in this slice: `BUG-718`, `BUG-719`, `BUG-720`, `BUG-721`, `BUG-722`, `BUG-723`, `BUG-724`.
