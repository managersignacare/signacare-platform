# A4c BUG-270 Local Evidence — `redactPhi` Traversal Hardening

**Date:** 2026-05-14  
**Lane:** A4c (Platform Hygiene + LLM Runtime Governance)  
**BUG:** `BUG-270`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. `apps/api/src/utils/phiFields.ts` redaction algorithm hardened:
   - replaced full-tree clone recursion with cycle-safe copy-on-write traversal,
   - only PHI-touched branches are cloned,
   - untouched branches preserve original references for lower allocation pressure on large log payloads.
2. Cycle safety:
   - traversal now memoizes visited objects via `WeakMap`,
   - self-referential payloads no longer risk recursion overflow.
3. Behavioral contract preserved:
   - PHI key taxonomy and `[REDACTED]` outputs unchanged,
   - input payload remains immutable to callers.

## Regression Proof (Local)

1. `npm run test -w apps/api -- tests/unit/loggerRedaction.test.ts` => PASS (`12/12`)
   - BUG-270 fast-path reference-stability proof,
   - touched-branch-only clone proof,
   - cycle-safe traversal proof.
2. `npm run lint:changed` => PASS
3. `npm run typecheck` => PASS
4. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Canary replay on high-volume logging paths (scheduler + scribe + audit-heavy routes).
2. Burn-in and post-burn-in verification attached per lane closure contract.
3. Catalogue row flips only after rollout evidence packet is attached.
