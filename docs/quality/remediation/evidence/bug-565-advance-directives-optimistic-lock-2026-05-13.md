# BUG-565 Evidence — Advance Directives Optimistic Lock

**Date:** 2026-05-13  
**Bug:** `BUG-565`  
**Lane context:** B3 follow-up (`BUG-402-FOLLOWUP-8`)

## Outcome

`advance_directives` mutations are now optimistic-lock protected. Concurrent PATCH writes no longer silently overwrite each other.

## Implementation Summary

1. Added migration `20260701000065_bug_565_advance_directives_lock_version.ts` with `lock_version INT NOT NULL DEFAULT 1`.
2. Added repository `advanceDirectiveRepository.ts` and routed PATCH updates through shared `updateWithOptimisticLock`.
3. Required `expectedLockVersion` at DTO boundary (`UpdateAdvanceDirectiveSchema`).
4. PATCH now fails loud on stale versions (`409 OPTIMISTIC_LOCK_CONFLICT`).
5. CREATE/PATCH responses echo `lockVersion` for retry-safe client behavior.

## Verification

- `npm run typecheck` => PASS
- `npm run lint:changed` => PASS
- `npm run guard:claude-discipline:ci` => PASS
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/bug565AdvanceDirectiveOptimisticLock.int.test.ts` => PASS (`4/4`)

### Integration Notes

- Initial integration run failed with `42703` because local integration DB had not yet applied migration `20260701000065`.
- Applied `npm run migrate:dev --workspace=apps/api` (Batch 75, migration applied), then reran integration suite to green.

## Anchors

- `R-FIX-BUG-565-MIGRATION-LOCK-VERSION`
- `R-FIX-BUG-565-REPO-USES-HELPER`
- `R-FIX-BUG-565-ROUTE-PATCH-OPTLOCK`
- `R-FIX-BUG-565-ZOD-REQUIRED`
- `R-FIX-BUG-565-INT-CREATE-LOCK`
- `R-FIX-BUG-565-INT-STALE-409`
- `R-FIX-BUG-565-INT-CONCURRENT`

