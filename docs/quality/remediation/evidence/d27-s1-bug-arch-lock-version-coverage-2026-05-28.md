# D27 S1 Closure — BUG-ARCH-LOCK-VERSION-COVERAGE

**Date:** 2026-05-28  
**Bug:** `BUG-ARCH-LOCK-VERSION-COVERAGE`  
**Scope:** Complete lock-version convergence for remaining multi-writer session surface + enforceable coverage guard.

## What Changed

1. Added schema migration for remaining gap:
   - `apps/api/migrations/20260701000087_bug_arch_lock_version_staff_sessions.ts`
   - Adds `staff_sessions.lock_version` (`integer NOT NULL DEFAULT 1`).

2. Converged auth session write paths:
   - `apps/api/src/features/auth/authRepository.ts`
   - Added lock-version-aware revoke updates via `buildSessionRevokePatch()`.
   - Added compatibility-safe column detection (`hasStaffSessionsLockVersionColumn`) so runtime remains stable before migration rollout.
   - Added `revokeSessionsByIds(...)` command and routed session-cap revocation through repository.

3. Updated auth service for session coverage:
   - `apps/api/src/features/auth/authService.ts`
   - Login session create now carries `lock_version: 1` (applied when column exists).
   - Session-cap revocation now uses repository command (no route-local direct update).

4. Updated generated row interface:
   - `apps/api/src/db/types/staff_sessions.ts`
   - `StaffSessionsRow` now includes `lock_version`.

5. Added machine contract + guard:
   - `.github/lock-version-coverage-contract.json`
   - `scripts/guards/check-lock-version-coverage-contract.ts`
   - Guard enforces:
     - required tables expose `lock_version` in generated row-types
     - critical write-path patterns remain lock-version-aware
   - Wired into `guard:claude-discipline` (`guard:lock-version-coverage-contract`).

6. Added fix-registry anchors:
   - `R-FIX-BUG-ARCH-LOCK-VERSION-COVERAGE-MIGRATION`
   - `R-FIX-BUG-ARCH-LOCK-VERSION-COVERAGE-GUARD`
   - `R-FIX-BUG-ARCH-LOCK-VERSION-COVERAGE-CONTRACT`
   - `R-FIX-BUG-ARCH-LOCK-VERSION-COVERAGE-AUTH-PATCH`

## Gate Evidence (local)

- `cd apps/api && npx tsc --noEmit` ✅
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/bugSa010CriticalPathPerformance.int.test.ts` ✅
- `npm run -s guard:lock-version-coverage-contract` ✅
- `npm run -s guard:claude-discipline:ci` ✅
- `bash .github/scripts/check-fix-registry.sh` ✅
- `npm run -s guard:bugs-remaining-uniqueness` ✅

## Closure Note

`BUG-ARCH-LOCK-VERSION-COVERAGE` is closed as a structural control: the remaining
session multi-writer surface is now lock-version-enabled with migration + write-path
convergence + guard-backed contract to prevent regression.
