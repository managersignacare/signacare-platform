# B2 — BUG-404 follow-up: outcomes error-envelope hardening (2026-05-14)

## Scope

Close a residual route-boundary inconsistency on the outcomes create path by removing inline error JSON and enforcing canonical global error-envelope behavior.

## Changes

1. Updated `apps/api/src/features/outcomes/outcomeRoutes.ts`:
   - imported `AppError` from `apps/api/src/shared/errors.ts`;
   - replaced inline `res.status(422).json({ error, code, details })` validation response with:
     - `return next(new AppError('Validation error', 422, 'VALIDATION_ERROR', parsed.error.flatten()));`

2. Updated guard decisiveness pin metadata:
   - `scripts/guards/check-fix-registry-decisiveness.allowlist`
   - refreshed expected hit counts after prior allowlist-drain work:
     - `R-FIX-BUG-638-ALLOWLIST-CITES-CASCADE` `933 -> 910`
     - `R-FIX-PHASE-R1-PR1.5-RESPONSE-MIGRATED` `909 -> 886`
     - `R-FIX-NEW-S2-SCHEDULER-SOFT-DELETE-MHA` `6 -> 9`

## Verification

- `npm run guard:error-envelope-consistency` => PASS
- `npm run test:integration -w apps/api -- tests/integration/bug404AssessmentMandatoryFields.int.test.ts tests/integration/bug566LegalOrdersOptimisticLock.int.test.ts tests/integration/legalOrderAndClinicSettingsAudit.int.test.ts tests/integration/bugOncCommandOwnership.int.test.ts tests/integration/bugRfRbacPermissionMatrix.int.test.ts` => PASS (all files green)
- `npm run guard:fix-registry-decisiveness` => PASS
- `npm run guard:all` => PASS

## Outcome

Outcomes validation errors now flow through the canonical global envelope path, preventing route-local envelope drift from silently reappearing.
