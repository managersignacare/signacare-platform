# B5 BUG-418 — ErrorBoundary Truthfulness Hardening Evidence (2026-05-12)

## Scope

Lane: `B5`  
Primary bug: `BUG-418`

## Root-Cause Class

Shared FE error handling rendered raw runtime exception messages in production, leaking implementation detail and creating non-truthful user experience under failure conditions.

## Structural Fix Implemented

1. Refactored `ErrorBoundary` into:
   - hook wrapper that reads rollout control flag
   - core class boundary for error capture + reset behavior
2. Added safe message resolver:
   - `resolveErrorBoundaryMessage(error, policy)`
3. Defaulted production path to safe generic copy:
   - `An unexpected error occurred in this section. Please try again.`
4. Added feature-flag controlled raw-detail path:
   - `b5-error-boundary-raw-details`
   - fail-closed when flag absent/unset.
5. Preserved dev diagnostics:
   - local/dev mode still permits raw message rendering.

## Verification (same session)

1. `cd apps/web && npx vitest run src/shared/components/ui/ErrorBoundary.test.ts`  
   - PASS
2. `npm run lint:changed`  
   - PASS
3. `npm run typecheck`  
   - PASS
4. `npm run guard:claude-discipline:ci`  
   - PASS
5. `npx playwright test --project=chromium e2e/probes/route-crawler.spec.ts --reporter=line`  
   - PASS (`57/57`)

## Closure Posture

- BUG-418 implementation and local gate verification are complete in-repo.
- Rollout closure remains pending canary + burn-in + post-burn-in rerun under program governance.
