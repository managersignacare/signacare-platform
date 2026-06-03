# A4b BUG-328 Local Evidence — LLM Bypass Audit Write-Failure Alert Signal

**Date:** 2026-05-14  
**Lane:** A4b (Security / Privacy / Observability)  
**BUG:** `BUG-328`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Added bypass-audit-specific failure alert metadata in `writeAuditLog`:
   - `alertKind: llm_access_bypass_audit_write_failed`
   - `bugId: BUG-328`
   - `action: LLM_ACCESS_BYPASS_ROLE`
2. Signal is attached in all write-failure branches:
   - non-staff retry failure
   - v2 + legacy dual-failure path
   - non-schema primary failure path
   - outer fallback catch path
3. Existing bounded-failure behavior remains unchanged:
   - request path still fail-open (no throw to clinical flow)
   - outbox fallback path remains intact.

## Regression Proof (Local)

1. `npm run test -w apps/api -- tests/unit/auditWriteTimeoutFallback.test.ts` => PASS (`6/6`)
2. `BUG-328-1` assertion in the test suite confirms failure log context includes:
   - `kind: tier_5_9_audit_write_failed`
   - `action: LLM_ACCESS_BYPASS_ROLE`
   - `alertKind: llm_access_bypass_audit_write_failed`
3. `npm run lint:changed` => PASS
4. `npm run typecheck` => PASS
5. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Canary replay validates log pipeline alert binding on `alertKind=llm_access_bypass_audit_write_failed`.
2. Burn-in and post-burn-in verification completed per lane closure contract.
3. Catalogue row flips only after rollout evidence packet is attached.
