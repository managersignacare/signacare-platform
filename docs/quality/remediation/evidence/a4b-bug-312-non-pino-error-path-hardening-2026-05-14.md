# A4b BUG-312 Local Evidence — Non-Pino Error-Path Hardening

**Date:** 2026-05-14  
**Lane:** A4b (Security / Privacy / Observability)  
**BUG:** `BUG-312`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Runtime residual migration to pino:
   - `apps/api/src/mcp/localLlmAgent.ts`
     - replaced raw console error/fallback logs with structured pino events:
       - `kind: 'local_llm_generate_failed'`
       - `kind: 'local_llm_generate_fallback'`
   - `apps/api/src/features/patients/zitaviSyncRoutes.ts`
     - replaced module-level integration-disabled `console.warn` with structured pino warn:
       - `kind: 'zitavi_integration_disabled'`
2. New fail-closed regression guard:
   - `scripts/guards/check-non-pino-error-paths.ts`
   - npm script: `guard:non-pino-error-paths`
   - integrated in global `guard:all` execution path
3. Guard contract:
   - blocks `console.error` and `console.warn` in runtime app code
   - permits only explicit bootstrap/system boundaries where logger bootstrap ordering requires controlled exceptions
   - keeps seed/demo utility scripts out of scope

## Local Verification

1. `npm run guard:non-pino-error-paths` => PASS
2. `npm run lint:changed` => PASS
3. `npm run typecheck` => PASS
4. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Canary log replay confirms no new raw runtime `console.error`/`console.warn` signatures on clinical request paths.
2. Burn-in and post-burn-in verification completed per lane closure contract.
3. Catalogue row flips only after rollout evidence packet is attached.
