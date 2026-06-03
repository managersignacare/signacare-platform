# A4a BUG-340 Local Evidence — NPDS Conformance Rename/Merge Fallback

**Date:** 2026-05-14  
**Lane:** A4a (External Integration Transport and Interop)  
**BUG:** `BUG-340`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Hardened NPDS conformance resolution path:
   - `apps/api/src/integrations/escript/npdsClient.ts`
   - `resolveNpdsConformanceId(clinicId)` now resolves in this order:
     1. active clinic row `npds_conformance_id`,
     2. unique active sibling clinic with same HPI-O (`BUG-340` fallback),
     3. env fallback (`NPDS_CONFORMANCE_ID`) as transitional final path.
2. Added ambiguity fail-visible logging:
   - if sibling clinics for same HPI-O carry multiple conformance IDs, path logs explicit error and only then falls back to env.
3. Preserved existing transitional compatibility:
   - existing BUG-302 env fallback contract remains in place for unresolved clinics.
4. Expanded regression coverage:
   - `apps/api/tests/integration/npdsConformancePerClinic.int.test.ts`
   - new `T8` (shared-HPI-O sibling fallback success),
   - new `T9` (ambiguous sibling IDs -> env fallback),
   - existing seeded rows updated to include HPI-O under current A2 constraints.

## Local Verification

1. `npm run test:integration -w apps/api -- tests/integration/npdsConformancePerClinic.int.test.ts` => PASS (`9/9`)
2. `npm run lint:changed` => PASS
3. `npm run typecheck` => PASS
4. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Replay canary NPDS submit/cancel/query workflows against renamed/merged clinic scenarios.
2. Complete burn-in and post-burn-in verification per A4a lane contract.
3. Flip catalogue row only after rollout evidence packet is attached.
