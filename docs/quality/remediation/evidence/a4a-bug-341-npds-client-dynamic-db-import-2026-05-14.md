# A4a BUG-341 Local Evidence — NPDS Client Dynamic DB Import

**Date:** 2026-05-14  
**Lane:** A4a (External Integration Transport and Interop)  
**BUG:** `BUG-341`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Preserved and documented lazy DB import contract in NPDS client:
   - `apps/api/src/integrations/escript/npdsClient.ts`
   - `resolveNpdsConformanceId(...)` explicitly keeps:
     - `await import('../../db/db')`
   - Added inline BUG-341 annotation clarifying no static top-level DB import.
2. Added regression-proof source contract test:
   - `apps/api/tests/unit/bug341NpdsClientDynamicDbImport.test.ts`
   - Asserts dynamic import anchor exists.
   - Asserts static `../../db/db` import is absent.

## Local Verification

1. `npm run test -w apps/api -- tests/unit/bug341NpdsClientDynamicDbImport.test.ts` => PASS (`1/1`)
2. `npm run lint:changed` => PASS
3. `npm run typecheck` => PASS
4. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Replay canary NPDS submit/cancel/query flows to confirm no runtime bootstrap regressions.
2. Complete burn-in and post-burn-in verification per lane contract.
3. Flip catalogue row only after rollout evidence packet is attached.
