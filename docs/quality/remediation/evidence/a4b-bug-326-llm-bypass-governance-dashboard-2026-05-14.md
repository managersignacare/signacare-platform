# A4b BUG-326 Local Evidence — LLM Bypass Governance Dashboard Surface

**Date:** 2026-05-14  
**Lane:** A4b (Security / Privacy / Observability)  
**BUG:** `BUG-326`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Compliance summary governance counters:
   - `governance.llmBypassLast30Days`
   - `governance.llmBypassLast90Days`
2. New governance route:
   - `GET /api/v1/reports/llm-bypass-audit`
   - tenant-scoped filter contract:
     - `startDate`
     - `endDate`
     - `staffId`
     - `endpoint`
     - `limit`
3. Response payload now includes:
   - rolling counts (`last30Days`, `last90Days`)
   - `totalMatched`
   - `byStaff` breakdown
   - `byEndpoint` breakdown
   - `events` feed from canonical audit events
4. Fail-closed contract and error handling:
   - response is validated with `LlmBypassAuditResponseSchema.parse(...)`
   - invalid query inputs route through `AppError` validation envelope path
5. Frontend governance visibility:
   - Compliance dashboard renders 30-day and 90-day LLM bypass cards.

## Regression Proof (Local)

1. `npm run test:integration -w apps/api -- tests/integration/bug326LlmBypassGovernanceDashboard.int.test.ts` => PASS (`3/3`)
2. `npm run test:integration -w apps/api -- tests/integration/reportsRoutesHealth.int.test.ts` => PASS (`5/5`)
3. `npm run lint:changed` => PASS
4. `npm run typecheck` => PASS
5. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Canary replay with known bypass audit samples confirms counters and breakdowns behave correctly in live-like traffic.
2. Burn-in and post-burn-in verification are completed per lane closure contract.
3. Catalogue row flips only after rollout evidence packet is attached.
