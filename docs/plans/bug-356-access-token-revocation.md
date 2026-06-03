# Plan — BUG-356: Access-token revocation via jwtBlacklist wiring

## 1. Context

BUG-356 was catalogued in commit `48b3eae` (S1 security, Phase-0.5-follow-up, open) as the **structural prerequisite for BUG-353**. L4 + L5 retroactive reviews on BUG-353 (2026-04-23) identified that:

- Post-demotion / deactivation / soft-delete, a staff member's existing JWT access token remains valid for up to **60 minutes** (default `JWT_ACCESS_TTL_MINUTES` at `apps/api/src/config/config.ts:21`).
- `authMiddleware.ts:17-98` never reads `staff_sessions.revoked_at`. It only verifies JWT signature + exp, then trusts the payload claims (including role + permissions).
- `apps/api/src/middleware/jwtBlacklist.ts` exists as complete-but-dead code — `blacklistToken`, `isTokenBlacklisted`, `blacklistAllUserTokens`, `isUserRevokedAfter` — with **zero consumers** across `apps/api/src/`.
- Without wiring this module into authMiddleware, any future BUG-353 re-attempt is a NO-OP.

**Goal:** wire the existing `jwtBlacklist.ts` into the auth plane so a call to `blacklistAllUserTokens(staffId)` immediately invalidates every access token issued to that staff. Required for BUG-353 (force-logout on role demotion / deactivation / soft-delete) to become a real security control.

**Scope boundary (explicit non-goals):**
- Not touching refresh-token revocation (`authService.refresh()` already reads `staff_sessions.revoked_at`).
- Not adding per-session `jti` claims (Option B in parked-work.md — deferred).
- Not changing `JWT_ACCESS_TTL_MINUTES` (Option C — deferred).
- Not re-attempting BUG-353 (the DB trigger). This commit only unlocks the prerequisite.
- Not touching the patient-app JWT path (preserves existing patient-app semantics; `blacklistAllUserTokens(patientId)` would be a future extension).

## 2. Existing code to reuse (grep-verified)

- **`apps/api/src/middleware/jwtBlacklist.ts`** lines 15-67 — four functions, Redis-backed, TTL-aware, fail-open on Redis error (correct pattern — don't block login because Redis is down). Zero consumers confirmed via:
  ```
  grep -rn "blacklistToken\|isTokenBlacklisted\|blacklistAllUserTokens\|isUserRevokedAfter" apps/api/src/ | wc -l → 8 (all within jwtBlacklist.ts itself + test file references)
  ```
- **`apps/api/src/middleware/authMiddleware.ts:26`** — `jwt.verify` returns payload with `iat` field. Already in scope.
- **`apps/api/src/features/staff/staffService.ts:166-203` `updateStaff`** — canonical write path for staff role / is_active / discipline updates. Hooks after `this.repo.update` commits.
- **`apps/api/src/features/staff/staffRepository.ts`** — `update(id, clinicId, patch)` returns the updated row. Need to check whether a `deleted_at` soft-delete path exists or whether deactivation goes through `is_active=false`.
- **`apps/api/src/utils/logger.ts`** — pino logger for `logger.warn` on Redis degradation.
- **`apps/api/tests/integration/_helpers.ts`** — `loginAsAdmin`, `authedRequest` (from the BUG-354 test file pattern), `isIntegrationReady`.

## 3. Change surface (explicit per-file edits; no abstractions)

### 3.1 Wire the blacklist check into authMiddleware

**EDIT** `apps/api/src/middleware/authMiddleware.ts`:
- After `jwt.verify` (line 29) but BEFORE `req.user = user` (line 69), add an async `isUserRevokedAfter(payload.id, payload.iat)` check. If it returns `true`, throw `HttpError(401, "SESSION_REVOKED", "Session revoked by admin")`.
- The check must be async but the current `authMiddleware` is synchronous (calls `throw` rather than `next(err)` for auth failures). Change: the signature stays `(req, res, next)`, but the body wraps the existing logic in an async IIFE and calls `next(err)` on the new revoke-check failure path. The existing synchronous throws are preserved (caught by Express 5 error handling). This is a minimum-edit refactor that keeps the call contract.
- The revoke check is AFTER `jwt.verify` (so an invalid token is rejected first — don't even check Redis for invalid tokens).
- The revoke check fails-open if Redis is down (per existing `isUserRevokedAfter` semantics at jwtBlacklist.ts:60-66). Log a `logger.warn` so the degradation is observable.

### 3.2 Call blacklistAllUserTokens from the state-change write path

**EDIT** `apps/api/src/features/staff/staffService.ts` `updateStaff`:
- After `this.repo.update(id, clinicId, patch)` succeeds (line 194), detect whether any of `role`, `is_active`, or `deleted_at` changed vs `existing`.
- If any of those changed, call `blacklistAllUserTokens(id)` AFTER the repo update commits.
- Wrap in try/catch + `logger.error({ err, staffId: id }, '...')` — blacklist failure must not block the update, but must be observable.

### 3.3 Regression test

**NEW** `apps/api/tests/integration/bug356AccessTokenRevocation.int.test.ts`:
- **T1** Staff logs in → gets access token → admin calls `blacklistAllUserTokens(staffId)` directly → any protected endpoint with that token returns 401 SESSION_REVOKED.
- **T2** Staff logs in → admin updates their role via `PUT /staff/:id` → any endpoint with the pre-change token returns 401 SESSION_REVOKED. (This proves the updateStaff hook works end-to-end.)
- **T3** Staff logs in → admin updates their `givenName` (benign field) → pre-change token STILL WORKS (200 on protected endpoint). This proves the hook only fires on role / is_active / deleted_at.
- **T4** Redis down (simulated via mocking `isUserRevokedAfter` to throw) → token remains valid (fail-open). Cannot simulate real Redis down in integration tests; assert the fail-open behaviour via `isUserRevokedAfter` unit test OR rely on existing `isUserRevokedAfter` having that semantic.

### 3.4 fix-registry anchor + catalogue state update

**EDIT** `docs/fix-registry.md` — new anchor `R-FIX-BUG-356-AUTHMIDDLEWARE-JWT-BLACKLIST-WIRED`.
**EDIT** `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — BUG-356 state → `fixed`, shipped_in = [this commit hash]; BUG-353 stays `open` but its `blocked_by: [BUG-356]` becomes clearable (separate future commit to actually redo BUG-353).

## 4. Test plan

**TDD evidence (L2.5):**
- Before wiring: T1 expects 401 but current authMiddleware returns 200 → FAIL.
- After wiring: T1 returns 401 SESSION_REVOKED → PASS.
- T2 same shape — pre-wiring FAIL, post-wiring PASS.
- T3 both before and after: 200 (benign given_name change doesn't touch blacklist).

**Adjacent suites that must stay green:**
- `apps/api/tests/integration/authBoundaries.test.ts` — existing auth chain behaviour (login / refresh / logout). Zero regression expected.
- `apps/api/tests/integration/clinicalAccessRbac.int.test.ts` (17 tests) — patient-access RBAC. Zero regression expected.
- `apps/api/tests/integration/clinicAccessAdminsPowerSettings.int.test.ts` (5 tests) — admin-slot management. Zero regression expected.
- `apps/api/tests/integration/accessAdminSlotIntegrityTrigger.int.test.ts` (6 tests) + `accessAdminSlotIntegrityTriggerAudit.int.test.ts` (3 tests) — BUG-354 behaviour. Zero regression expected.

**Flake check:** new suite ×3 in isolation, zero flake.

## 5. Gate (10-check — per PART 13.1)

All 10 checks must pass. This commit is RISKY-class:
- Touches `apps/api/src/middleware/authMiddleware.ts` → `auth/` prefix → L3 + L4 + L5 all mandatory.
- Touches `apps/api/src/features/staff/staffService.ts` → S1 security → L3 + L4 + L5 all mandatory.
- S1 severity per catalogue → L3 mandatory.

Stop-rule at 2 consecutive REJECTs → halt + escalate.

## 6. Risk analysis

- **Risk: authMiddleware becomes async** — every request now waits on a Redis roundtrip. Mitigation: `isUserRevokedAfter` uses Redis GET (single key, ~1ms); fails-open on Redis error so never blocks login. Per-request overhead acceptable.
- **Risk: Blacklist TTL too long / short** — module uses 7-day TTL. If a user's refresh lifetime exceeds 7 days, a stale token could resurrect. Current refresh-token TTL is 14 days (config.ts:22). Acceptable gap? Refresh flow already reads `staff_sessions.revoked_at`, so a refresh attempt after day-7 blacklist expiry would be rejected at the refresh layer. Document in commit body.
- **Risk: Existing tokens at deploy time** — a staff who has a valid token at deploy time is NOT blacklisted. Correct semantic: blacklist only fires on NEW state changes post-deploy. Pre-existing stale tokens get handled by natural JWT expiry (60 min max).
- **Risk: Test bootstrap fragility** — `_helpers.ts loginAsAdmin` seeds the admin as nominated_admin. This test doesn't touch that; reuses the same login path.
- **Risk: cascade with BUG-353 re-attempt** — once BUG-356 lands, a future BUG-353 redo wires the DB trigger OR a service-layer call to `blacklistAllUserTokens` from the staff-state-change path. The updateStaff hook in 3.2 already covers the app-layer case — the DB trigger is belt-and-braces. Splitting is still correct.

## 7. Rollback plan

- `git revert <commit-hash>` restores the pre-wiring authMiddleware and un-hooks updateStaff.
- No DB migration → no schema rollback.
- Redis-resident blacklist keys (if any) auto-expire in 7 days per their TTL. No orphaned state.
