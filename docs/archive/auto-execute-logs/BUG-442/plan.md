# BUG-442 — jwtBlacklist fail-closed on Redis error — Plan

## Root cause (verified via code read)

Two internal silent catches in `apps/api/src/middleware/jwtBlacklist.ts` swallow Redis errors and return `false`, masking the failure from the caller:

- **line 46-48** — `isTokenBlacklisted(tokenId)`: `catch { return false; }` — no log
- **line 71-73** — `isUserRevokedAfter(userId, iat)`: `catch { return false; }` — no log

**Critical consequence:** `authMiddleware.ts:41-60` has a `.catch` handler that emits a structured `kind=jwt_blacklist_fail_open` warn log + continues the auth chain. Because the internal try/catch already eats the Redis error, the promise **never rejects** — the caller's `.catch` is **DEAD CODE**. Same for `scribeStreaming.ts:198` and `smartAuth.ts:550` (two other callers with identical dead `.catch` handlers).

Net effect: Redis outage silently defeats BUG-356's session-revocation observability. Operators cannot alert on sustained degradation because the alertable log never fires. This is EXACTLY the anti-pattern BUG-360 (silent-catch replacement with observable handlers) was introduced to prevent.

## Gold-standard fix

The correct architecture is already in place at the CALLER layer — every caller has a structured `kind=jwt_blacklist_fail_open` warn + continue-auth-chain handler per OWASP ASVS 2.8.7 fail-open-with-observability. The fix is to stop the internal silent catch from short-circuiting that observability.

1. Remove the silent catch blocks from both read functions
2. Let the Redis error propagate so the caller's `.catch` fires
3. Add no new behaviour — preserve BUG-356's documented fail-open semantics (caller side), just make them observable

This is the minimal surgical fix. The 3 fail-open decisions (auth / scribe / smart-auth) remain intact; their alerting now actually works.

## Files touched

- `apps/api/src/middleware/jwtBlacklist.ts` — remove 2 silent catches; let Redis errors propagate
- `apps/api/tests/jwtBlacklist.test.ts` — NEW test file (if not exists) OR extend existing
- `docs/quality/fix-registry.md` — new regression-prevention row
- `docs/quality/bugs-remaining.md` — mark BUG-442 fixed

## Tests

1. `isTokenBlacklisted` rejects when Redis `get` throws (no more silent false)
2. `isUserRevokedAfter` rejects when Redis `get` throws (no more silent false)
3. `isTokenBlacklisted` still returns `true` for an actively-blacklisted token (happy path preserved)
4. `isUserRevokedAfter` still returns `true` for a user whose revoke-all-timestamp is newer than iat (happy path preserved)
5. `isUserRevokedAfter` still returns `false` when no revoke flag exists (no-data path preserved)

## Risk / impact

- Callers: authMiddleware + scribeStreaming + smartAuth — all already have `.catch` handlers with structured `kind=jwt_blacklist_fail_open` logging. After this fix, the logs will actually fire on Redis error; today they are dead.
- Any OTHER caller that directly `await`s without a `.catch` would now throw. Grep confirmed: only the 3 above.
- No behaviour change when Redis is HEALTHY (happy path unchanged).
- staffService uses `blacklistAllUserTokens` (the write path); not touched.

## L3/L4/L5 expected

- L3: yes (always)
- L4: yes — §13.5 semantic trigger fires: "diff changes a fail-open boundary" (from internal-silent-fail-open to caller-observable-fail-open), also touches `middleware/`
- L5: yes — `middleware/` + auth + security boundary + affects observability architecture

## Fix-registry

`R-FIX-BUG-442-JWT-BLACKLIST-FAIL-CLOSED` — `absent` pattern asserting `catch {\s*return false;` must NOT appear in `jwtBlacklist.ts`.
