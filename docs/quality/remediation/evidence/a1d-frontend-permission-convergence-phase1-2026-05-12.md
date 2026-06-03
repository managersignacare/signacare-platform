# A1d Frontend Permission Convergence — Phase 1 Evidence (2026-05-12)

## Scope

Lane: `A1d`  
Primary bugs: `BUG-FE-RBAC-SPLIT`, `BUG-RECEPTIONIST-CLINICAL-NOTES-NO-ROLE-GUARD`, `BUG-RECEPTIONIST-SEES-CLINICAL-MGMT`

## Root-Cause Class

Frontend authorization logic was fragmented across route config, sidebar visibility, and page-level actions, allowing drift between expected backend policy and UI-exposed surfaces.

## Implemented Structural Fixes

1. Added shared FE authorization adapter:
   - `apps/web/src/shared/utils/frontendAccessPolicy.ts`
   - Centralized route rules, permission checks, patient-tab gating, and deterministic fallback.
2. Added FE policy unit proof:
   - `apps/web/src/shared/utils/__tests__/frontendAccessPolicy.test.ts`
3. Added reusable route guard:
   - `apps/web/src/shared/components/guards/RouteAccessGuard.tsx`
4. Wired policy-sensitive routes through guard:
   - `apps/web/src/router.tsx`
5. Converged nav visibility with centralized route policy:
   - `apps/web/src/shared/components/ui/Sidebar.tsx`
6. Enforced tab/action permission model in patient detail:
   - `apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx`
7. Blocked receptionist clinical-note create path unless `note:create`:
   - `apps/web/src/features/receptionist/pages/ReceptionistPage.tsx`

## Verification (same session)

1. `cd apps/web && npx vitest run src/shared/utils/__tests__/frontendAccessPolicy.test.ts`  
   - PASS (7/7)
2. `npm run lint:changed`  
   - PASS
3. `npm run typecheck`  
   - PASS
4. `npm run guard:claude-discipline:ci`  
   - PASS
5. `npx playwright test --project=chromium e2e/probes/rbac-matrix.spec.ts --reporter=line`  
   - PASS (20/20)

## Notes

- During RBAC probe execution, backend emitted `ERR_HTTP_HEADERS_SENT` from `staffSettingsRoutes.ts:598` (already catalogued as `BUG-717` in canonical ledger). This is tracked separately and is not introduced by this A1d FE scope.
- Redis eviction warning noise (`allkeys-lru` vs `noeviction`) appeared in probe logs and matches known prior catalog state.

## Closure Posture

- A1d in-repo implementation and local verification gates are complete.
- Canonical A1d bug rows remain `open` until rollout closure contract completes:
  - Azure canary evidence
  - 7-day auth/authorization burn-in
  - post-burn-in rerun evidence
