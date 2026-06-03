# A4c BUG-311 Local Evidence — SafeScript `.checked` Contract

**Date:** 2026-05-14  
**Lane:** A4c (Platform Hygiene + LLM Runtime Governance)  
**BUG:** `BUG-311`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Shared SafeScript contract SSoT introduced in `packages/shared/src/safeScript.schemas.ts`:
   - `SafeScriptPatientIdentifierSchema`,
   - `SafeScriptSupplySchema`,
   - `SafeScriptCheckResultSchema`.
2. SafeScript surfaces now consume one typed contract:
   - API controller validates input with shared `SafeScriptPatientIdentifierSchema`,
   - integration service returns only parsed `SafeScriptCheckResultSchema` payloads,
   - prescription response schema uses `SafeScriptCheckResultSchema.nullable()`,
   - FE SafeScript panel now consumes typed `SafeScriptCheckResult` directly.
3. Persistence gap closed:
   - `prescriptionRepository.updateSafescriptResult(...)` no longer no-ops;
   - writes `safescript_checked`, `safescript_checked_at`, `safescript_result`, updates `updated_at`;
   - fails closed with `404 NOT_FOUND` if the prescription row is missing.
4. Drift handling hardened:
   - response mapper (`prescriptionService`) normalizes persisted `safescript_result` via safe-parse;
   - malformed legacy payloads are dropped to `null` with structured warning signal (`BUG-311_SAFE_SCRIPT_RESULT_CONTRACT_DRIFT`) rather than leaking unknown shapes to clients.
5. Regression test added:
   - `apps/api/tests/integration/bug311SafeScriptCheckedContract.int.test.ts`
   - asserts success-path persistence and malformed-payload fail-closed behavior with state immutability.

## Regression Proof (Local)

1. `npm run test:integration -w apps/api -- tests/integration/bug311SafeScriptCheckedContract.int.test.ts` => PASS (`2/2`)
2. `npm run test:integration -w apps/api -- tests/integration/prescriptionsDisciplineBarrier.int.test.ts` => PASS (`9/9`)
3. `npm run lint:changed` => PASS
4. `npm run typecheck` => PASS
5. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Canary replay of SafeScript-check flow with persistence verification on live runtime topology.
2. Burn-in + post-burn-in evidence packet showing no SafeScript contract drift.
3. Catalogue row flip only after rollout closure contract is satisfied.
