# B1/B2/B3 Evidence — BUG-461 (Shared Legal-Order Response Schema)

Date: 2026-05-14  
Lane: B1/B2/B3 (legal family)  
Scope: `BUG-461`

## Objective

Replace route-local legal-order response schema definitions with a shared contract exported from `@signacare/shared`.

## Changes

1. Added shared legal-order response schemas in `packages/shared/src/legalOrder.Schemas.ts`:
   - `LegalOrderResponseSchema`
   - `LegalOrderListItemResponseSchema`
   - `LegalOrderListResponseSchema`
   - `LegalOrderCreateResponseSchema`
   - `LegalOrderUpdateResponseSchema`
2. Updated `apps/api/src/features/legal/legalOrderRoutes.ts`:
   - Removed inline local Zod response schema definitions.
   - Imported and used the shared schema exports for response parsing.

## Regression Proof

1. Integration:
   - `npm run test:integration -w apps/api -- tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts tests/integration/bug566LegalOrdersOptimisticLock.int.test.ts` => PASS (`5/5` + `6/6`)
2. Repo health:
   - `npm run lint:changed` => PASS
   - `npm run typecheck` => PASS

## Outcome

Legal-order response contract is now centralized in shared schemas, eliminating route-local schema drift on legal-order response payloads.
