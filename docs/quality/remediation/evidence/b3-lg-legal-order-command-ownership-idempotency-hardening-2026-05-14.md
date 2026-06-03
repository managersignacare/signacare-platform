# B1/B2/B3 Evidence — BUG-LG Family Legal-Order Hardening

Date: 2026-05-14  
Lane: B1/B2/B3 (legal-order family)  
Scope: `BUG-LG-*` local prevention controls

## Objective

Close residual legal-order integrity gaps by hardening command ownership and auto-contact idempotency behavior, then pin the contract with regression-proof tests.

## Changes

1. Auto-contact idempotency + lifecycle hardening on legal-order side effects:
   - `apps/api/src/features/contacts/autoContactRecord.ts`
   - Explicit transaction scope with advisory lock on `(clinicId, sourceId)` and deterministic existing-row reuse.
   - Reuse path now logs as debug (`Reused existing ABF contact record`) instead of duplicate "Auto-created" info logs.
2. Post-response middleware transaction safety:
   - `apps/api/src/middleware/contactRecordMiddleware.ts`
   - Post-response callback now runs via `dbAdmin` with explicit tenant scoping so async write path cannot inherit an already-completed request transaction.
3. Legal-order source-level regression prevention:
   - `apps/api/tests/unit/bugLegalOrderCommandOwnershipAndResponseShape.test.ts`
   - Pins route command ownership (`legalOrderCrudService` only), schema-validated response boundaries, and canonical legal-order audit action usage.
4. Integration proof tightened on legal-order side-effect surface:
   - `apps/api/tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts`
   - Wait/reconcile check confirms exactly one contact record per legal-order source id.

## Regression Proof

- `npm run test -w apps/api -- tests/unit/bugLegalOrderCommandOwnershipAndResponseShape.test.ts` => PASS (`3/3`)
- `npm run test:integration -w apps/api -- tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts tests/integration/bug566LegalOrdersOptimisticLock.int.test.ts` => PASS (`5/5` + `6/6`)
- `npm run guard:all` => PASS

## Outcome

Legal-order writes now keep deterministic command ownership and idempotent contact side effects with accurate logging semantics, reducing hidden duplicate-side-effect drift risk while preserving optimistic-lock and audit-forensics guarantees.
