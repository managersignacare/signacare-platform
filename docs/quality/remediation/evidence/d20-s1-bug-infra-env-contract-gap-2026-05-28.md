# D20 — BUG-INFRA-ENV-CONTRACT-GAP Closure Evidence

**Date:** 2026-05-28  
**Bug:** `BUG-INFRA-ENV-CONTRACT-GAP` (S1, pre-deployment)  
**Scope:** Runtime env contract completeness + regression guard hardening.

## What changed

1. Upgraded `scripts/guards/check-env-template-contract.ts` from static key-check to structural contract guard:
   - Validates canonical template presence + non-zero-byte state.
   - Scans runtime sources via AST for env references:
     - `process.env.KEY`
     - `process.env['KEY']`
     - `requireEnv('KEY')` / `optionalEnv('KEY')`
     - `import.meta.env.KEY`
   - Fails on undocumented runtime keys.
   - Fails on stale catalog keys no longer referenced by runtime code.

2. Added canonical web env template:
   - `apps/web/.env.example`
   - Includes `VITE_API_URL`, `VITE_SCRIBE_LIVE_TRANSCRIPT`.

3. Added authoritative env-key catalog:
   - `docs/operations/env-contract-catalog.md`
   - Non-secret source-of-truth list for runtime env keys.

4. Expanded API env documentation:
   - `apps/api/.env.example` includes an explicit extended runtime env section
     for integration/security/observability knobs.
   - `apps/api/.env.production.template` now includes production operator
     placeholders for integration/fail-loud keys (FCM/ACS/SafeScript/NPDS/etc).

5. Updated root pointer:
   - `.env.example` now references `apps/web/.env.example`.

## Gate evidence

- `npm run guard:env-template-contract` → PASS  
  Output: `✓ Env template contract passed (5 template files, 197 runtime env keys, 197 catalog keys).`

## Result

`BUG-INFRA-ENV-CONTRACT-GAP` moved to **fixed** with a structural guard and
runtime-key catalog to prevent recurrence.
