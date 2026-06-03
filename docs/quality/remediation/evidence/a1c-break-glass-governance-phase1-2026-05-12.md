# A1c Evidence — Break-Glass Governance Phase 1 (2026-05-12)

## Scope

- Lane: `A1c` break-glass + sensitive-access governance
- File scope (this slice):
  - `apps/api/src/features/auth/breakGlassRoutes.ts`
  - `apps/api/src/middleware/breakGlassAuditMiddleware.ts`
  - `apps/api/tests/integration/breakGlassAudit.test.ts`

## Structural Changes

1. Tightened justification semantics on break-glass request/deny payloads
   - `reason` and `deniedReason` now use trimmed validation at request boundary.
   - Whitespace-only justification is rejected at schema layer (fail-closed before DB write).
2. Active-account enforcement for break-glass lifecycle
   - Request path now requires active requester account.
   - Approve path now checks requester is still active; inactive requester sessions are auto-denied with audit evidence.
   - Runtime middleware now re-validates active staff state on each break-glass request and revokes session if requester becomes inactive.
3. Sensitive-access flagging on break-glass action trail
   - `actions_performed` descriptors now include:
     - `sensitiveAccess` boolean
     - `sensitiveFlag` (`mental_health_sensitive_record` when applicable)
   - Classification covers patient/clinical data routes and preserves full method/path/timestamp trail.

## Verification

- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/breakGlassAudit.test.ts` => PASS (10/10)
- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## Key Assertions Added

- Inactive requester cannot request break-glass.
- Approved break-glass token is revoked when requester account becomes inactive.
- Patient-route actions under break-glass are tagged with explicit sensitive-access flag evidence.
- Whitespace-only break-glass justification is rejected.
