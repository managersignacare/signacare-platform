# B4 BUG-576 — Legal CRUD Consolidation Evidence (2026-05-13)

## Scope

Close the implementation slice for `BUG-576` by extracting legal-order CRUD from inline patient routes into a dedicated legal feature module with AuthContext-typed service enforcement.

## Implementation Summary

1. Added dedicated legal CRUD module files:
   - [apps/api/src/features/legal/legalOrderRoutes.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/legal/legalOrderRoutes.ts)
   - [apps/api/src/features/legal/legalOrderCrudService.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/legal/legalOrderCrudService.ts)
   - [apps/api/src/features/legal/legalOrderCrudRepository.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/legal/legalOrderCrudRepository.ts)
2. Removed inline legal-order CRUD orchestration from [apps/api/src/features/patients/patientRoutes.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/features/patients/patientRoutes.ts).
3. Mounted legal-order router as first-class route in [apps/api/src/server.ts](/Users/drprakashkamath/Projects/Signacare/apps/api/src/server.ts) at `/api/v1/patients`.
4. Preserved endpoint contracts:
   - `GET /api/v1/patients/:id/legal-orders`
   - `POST /api/v1/patients/:id/legal-orders`
   - `PATCH /api/v1/patients/legal-orders/:orderId`
5. Preserved legal-order audit semantics in service layer:
   - `LEGAL_ORDER_CREATE`
   - `LEGAL_ORDER_UPDATE`
   - `LEGAL_ORDER_AUTO_EXPIRED`

## Verification Commands

1. `npm run lint:changed`
2. `npm run typecheck`
3. `npm run guard:claude-discipline:ci`
4. `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts`

## Verification Results

- `npm run lint:changed` => PASS
- `npm run typecheck` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts` => PASS (`5/5`)

## BUG Ledger State

- `BUG-576`: implementation landed in-repo; rollout closure (canary + burn-in + post-burn-in verification) remains required before final close.
