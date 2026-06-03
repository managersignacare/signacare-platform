# BUG-566 Evidence — Legal Orders Optimistic Lock

**Date:** 2026-05-13  
**Bug:** `BUG-566`  
**Lane context:** B3 follow-up (`BUG-402-FOLLOWUP-9`)

## Outcome

Legal-order PATCH mutations are now optimistic-lock protected. Concurrent updates no longer silently overwrite each other.

## Implementation Summary

1. Added migration `20260701000066_bug_566_legal_orders_lock_version.ts` with `lock_version INT NOT NULL DEFAULT 1` on:
   - `patient_legal_orders`
   - `legal_orders`
2. Required `expectedLockVersion` at DTO boundary (`UpdateLegalOrderSchema`).
3. Routed `patient_legal_orders` PATCH update path through `updateWithOptimisticLock` in `legalOrderCrudRepository`.
4. Added `lockVersion` to legal-order API responses and wired frontend legal-order edits to echo it on PATCH.
5. Updated auto-expire mutation to bump `lock_version` so post-expiry edits cannot proceed on stale versions.

## Verification

- `npm run typecheck` => PASS
- `npm run lint:changed` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `npm run test:integration -w apps/api -- bug566LegalOrdersOptimisticLock.int.test.ts legalOrderAndClinicSettingsAudit.int.test.ts` => PASS (`6/6` + `5/5`)

## Anchors

- `R-FIX-BUG-566-MIGRATION-LOCK-VERSION-PATIENT-LEGAL-ORDERS`
- `R-FIX-BUG-566-MIGRATION-LOCK-VERSION-LEGAL-ORDERS`
- `R-FIX-BUG-566-ZOD-REQUIRED`
- `R-FIX-BUG-566-REPO-USES-HELPER`
- `R-FIX-BUG-566-ROUTE-LOCKVERSION-RESPONSE`
- `R-FIX-BUG-566-WEB-EXPECTED-LOCKVERSION`
- `R-FIX-BUG-566-INT-PATIENT-LEGAL-ORDERS-LOCK`
- `R-FIX-BUG-566-INT-STALE-409`
- `R-FIX-BUG-566-INT-CONCURRENT`
- `R-FIX-BUG-566-INT-LEGAL-ORDERS-LOCK-COLUMN`
