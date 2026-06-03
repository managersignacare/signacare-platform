# A4a BUG-335 Local Evidence — Frontend ERX_NOT_CONFIGURED Branching

**Date:** 2026-05-14  
**Lane:** A4a (External Integration Transport and Interop)  
**BUG:** `BUG-335`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Added canonical frontend error-branch helper:
   - `apps/web/src/features/medications/services/erxErrorMessage.ts`
   - Handles backend `ERX_NOT_CONFIGURED` with field-aware guidance:
     - `clinics.hpio` -> HPI-O setup guidance
     - `clinics.npds_conformance_id` -> NPDS conformance setup guidance
     - directs to `Org Settings -> eRx Setup`.
2. Wired helper into live eRx-facing actions:
   - `apps/web/src/features/medications/components/CurrentMedsPanel.tsx`
     - token reissue error path (`/prescriptions/:id/deliver-token`)
     - cancel-prescription error fallback branch
   - `apps/web/src/features/medications/components/PrescriptionForm.tsx`
     - create-error alert now uses ERX-aware branch helper
3. Added regression test pin:
   - `apps/web/src/features/medications/services/erxErrorMessage.test.ts`
   - covers HPI-O branch, NPDS branch, non-ERX passthrough, and fallback behavior.

## Local Verification

1. `npx vitest run apps/web/src/features/medications/services/erxErrorMessage.test.ts --config ./vitest.config.ts` => PASS (`4/4`)
2. `npm run lint:changed` => PASS
3. `npm run typecheck` => PASS
4. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Replay canary eRx failure-path UX with intentional missing clinic HPI-O and missing NPDS conformance-id scenarios; capture user-facing message evidence.
2. Complete burn-in and post-burn-in verification per lane contract.
3. Flip catalogue row only after rollout evidence packet is attached.
