# BUG-568 Evidence — Treatment Pathways Audit Actor

Date: 2026-05-13  
Lane: treatment-pathways hardening follow-up (BUG-402 cascade)  
Status: implementation complete in repo; rollout closure pending

## Scope

- BUG-568: add `updated_by_staff_id` actor stamping and forensic mutation audit coverage for treatment-pathway mutations.

## Implementation Summary

1. Added migration `20260701000064_bug_568_treatment_pathways_updated_by_staff_audit_actor.ts`
   - adds nullable `treatment_pathways.updated_by_staff_id` FK to `staff(id)` (`SET NULL`)
   - adds index `idx_treatment_pathways_updated_by_staff_id`
2. Added service boundary `apps/api/src/features/treatment-pathways/pathwayService.ts`
   - create/update/session mutations now centralized
   - all mutation flows stamp `updated_by_staff_id = auth.staffId`
   - all mutation flows emit `writeAuditLog(...)` with mutation metadata
3. Rewired routes in `pathwayRoutes.ts`
   - create, patch, session handlers now delegate to service methods
4. Integration coverage:
   - updated BUG-402 integration cross-clinic fixture for current clinic schema (`hpio` required)
   - added BUG-568 integration suite proving actor stamping + audit evidence path

## Verification

- `npm run lint:changed` PASS
- `npm run typecheck` PASS
- `npm run guard:claude-discipline:ci` PASS
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/bug402TreatmentPathwayOptimisticLock.int.test.ts` PASS (`7/7`)
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/bug568TreatmentPathwayAuditActor.int.test.ts` PASS (`3/3`)

## Notes

- In this environment, `writeAuditLog` frequently takes the BUG-283 bounded-timeout fallback path (`audit_log` insert timeout -> Redis outbox enqueue).  
- The BUG-568 integration suite validates audit evidence via either canonical path:
  - direct row in `audit_log`
  - queued row in Redis `audit:outbox`

## Fix Anchors

- `R-FIX-BUG-568-MIGRATION-COLUMN`
- `R-FIX-BUG-568-REPO-UPDATED-BY-PATCH`
- `R-FIX-BUG-568-ROUTE-CREATE-SERVICE`
- `R-FIX-BUG-568-ROUTE-PATCH-SERVICE`
- `R-FIX-BUG-568-ROUTE-SESSION-SERVICE`
- `R-FIX-BUG-568-CREATE-ACTOR-STAMP`
- `R-FIX-BUG-568-CREATE-AUDIT`
- `R-FIX-BUG-568-UPDATE-ACTOR-STAMP`
- `R-FIX-BUG-568-UPDATE-AUDIT`
- `R-FIX-BUG-568-SESSION-ACTOR-STAMP`
- `R-FIX-BUG-568-SESSION-AUDIT`
- `R-FIX-BUG-568-INT-CREATE-ACTOR-STAMP`
- `R-FIX-BUG-568-INT-UPDATE-AUDIT`
- `R-FIX-BUG-568-INT-SESSION-AUDIT`
