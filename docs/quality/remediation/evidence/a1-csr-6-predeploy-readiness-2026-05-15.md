# A1 CSR-6 Pre-Deployment Readiness Evidence (2026-05-15)

## Scope

- Phase-A `CSR-6` synthetic readiness for A1 surfaces:
  - RBAC backend + frontend convergence replay
  - break-glass governance replay
  - password-breach policy replay

## Commands and Results

1. `npm run test:integration -w apps/api -- tests/integration/breakGlassAudit.test.ts tests/integration/clinicAccessAdminsPowerSettings.int.test.ts`
   - PASS
   - `breakGlassAudit`: `10/10`
   - `clinicAccessAdminsPowerSettings`: `5/5`

2. `npm run test -w apps/api -- tests/unit/passwordBreachService.test.ts`
   - PASS
   - `6/6`

3. `cd apps/web && npx vitest run src/shared/utils/__tests__/frontendAccessPolicy.test.ts`
   - PASS
   - `7/7`

4. `npx playwright test --project=chromium e2e/probes/rbac-matrix.spec.ts --reporter=line`
   - PASS
   - `20/20`

5. `npm run guard:all`
   - PASS

6. `npm run typecheck`
   - PASS

## Verdict

- CSR-6 synthetic readiness is **GREEN**.
- No fail-open path observed in A1 replay.
- Remaining A1-family closure is Phase-B operational evidence only (`R1` posture).
