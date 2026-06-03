# A1a Auth Chain Phase-1 Evidence (2026-05-12)

## Scope

This artifact records A1a phase-1 hardening focused on bounded-failure semantics for auth lifecycle stages outside the login controller.

## Structural Changes

1. Added shared timeout primitive:
   - `apps/api/src/shared/authChainTimeout.ts`
2. Applied bounded timeout on revocation check in:
   - `apps/api/src/middleware/authMiddleware.ts`
3. Applied bounded timeout on idle-window redis stages in:
   - `apps/api/src/middleware/sessionIdleMiddleware.ts`
4. Applied bounded timeout + structured warning on login session-cap best-effort stages in:
   - `apps/api/src/features/auth/authService.ts`
5. Added timeout helper unit coverage:
   - `apps/api/tests/unit/authChainTimeout.test.ts`

## Why This Matters

- Prevents indefinite wait inheritance from Redis/network stalls in auth revocation and idle stages.
- Preserves required fail-open behavior where policy mandates availability-first semantics.
- Makes degraded auth-chain behavior observable with structured stage/reason fields.
- Keeps timeout policy centralized and testable.

## Verification Commands

1. `cd apps/api && npx vitest run tests/unit/authChainTimeout.test.ts tests/unit/withTimeout.test.ts`  
   Result: PASS (`12/12`)
2. `npm run typecheck`  
   Result: PASS
3. `npm run lint:changed`  
   Result: PASS
4. `npm run guard:claude-discipline:ci`  
   Result: PASS
5. `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/authJwtCrossUseRejection.int.test.ts tests/integration/sessionIdleConfig.int.test.ts`  
   Result: PASS (`13/13`)

## Residual Work (A1a Lane)

1. External rollout closure only: canary + burn-in + post-burn-in rerun evidence.
2. In-repo A1a structural closeout artifacts are now complete, including:
   - auth chain map: `docs/quality/remediation/evidence/a1a-auth-chain-map-2026-05-12.md`,
   - canonical bug-row reconciliation for `BUG-LOGIN-HANG` and `BUG-AUTH-CHAIN-HANGS-BROADLY`,
   - L5 auth workflow proof (`e2e/01-auth.spec.ts`, chromium 6/6).
