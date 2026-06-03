# A1a Auth Chain Map (2026-05-12)

## Purpose

This artifact is the A1a structural map for login/session auth lifecycle, with
bounded-failure semantics and measured stage timing.

## Canonical Chain

| Stage | Entry point | Implementation surface | Failure contract | Bounded timeout |
|---|---|---|---|---|
| Token parse/verify | protected route | `apps/api/src/middleware/authMiddleware.ts` (`verifyAccessToken`) | fail-closed `401 UNAUTHENTICATED` | N/A (in-process JWT verify) |
| Revocation check | protected route | `authMiddleware` + `jwtBlacklist.isUserRevokedAfter` | fail-open on Redis/timeout with structured warn (`kind=jwt_blacklist_fail_open`) | `withAuthChainStageTimeout('auth.middleware.revocation_check', ...)` |
| Idle-session read | protected route | `sessionIdleMiddleware` + Redis `GET idle:<staffId>` | fail-closed on idle-expired (`401 SESSION_EXPIRED`), fail-open on Redis/timeout | `withAuthChainStageTimeout('auth.session_idle.get', ...)` |
| Idle-session refresh | protected route | `sessionIdleMiddleware` + Redis `EXPIRE idle:<staffId>` | non-blocking best-effort; warn on timeout/upstream error | `withAuthChainStageTimeout('auth.session_idle.expire', ...)` |
| Break-glass / impersonation guards | protected route | `breakGlassAuditMiddleware`, `adminImpersonationAuditMiddleware` | fail-closed on invalid/expired special session | inherited middleware path |
| Tenant DB context | protected route | `rlsMiddleware` | fail-closed if RLS transaction setup fails | inherited middleware path |
| Login core auth | `/api/v1/auth/login` | `authController.loginController` -> `authService.login` | fail-closed on invalid credentials; bounded best-effort sub-stages | timed via `withTiming` (controller stages) |
| Login session-cap query | login path | `authService.login` (`staff_sessions` read) | non-blocking best-effort; warn on timeout/upstream error | `withAuthChainStageTimeout('auth.login.session_cap.query', ...)` |
| Login session-cap revoke | login path | `authService.login` (`staff_sessions` revoke overflow) | non-blocking best-effort; warn on timeout/upstream error | `withAuthChainStageTimeout('auth.login.session_cap.revoke', ...)` |

## Timing Evidence

Run command:

```bash
cd apps/api && AUTH_CHAIN_PINO_TIMING=1 LOGIN_PINO_TIMING=1 npx vitest run --config vitest.integration.config.ts tests/integration/authJwtCrossUseRejection.int.test.ts tests/integration/sessionIdleConfig.int.test.ts
```

Captured log: `/tmp/a1a-auth-timing.log`

Observed timing stages (same session):

| Stage | Count | Min ms | Max ms |
|---|---:|---:|---:|
| `login.authService.login` | 1 | 79 | 79 |
| `login.importStaffDb` | 1 | 0 | 0 |
| `login.readMustChangePasswordFlag` | 1 | 0 | 0 |
| `login.writeAuditLog` | 1 | 126 | 126 |
| `auth.middleware.revocation_check` | 7 | 0 | 1 |
| `auth.session_idle.get` | 7 | 0 | 0 |

## Guard Proof

Guard command:

```bash
npm run guard:login-path-pino-timing
```

Result:

- `awaited stages: 4`
- `wrapped with withTiming: 4`
- `bounded-stage checks: 5`
- `bounded-stage failures: 0`

This guard now verifies both:

1. login-controller awaited stages are timed, and  
2. required bounded-stage markers exist across `authMiddleware`,
   `sessionIdleMiddleware`, and `authService`.

## L5 Workflow Proof

Run command:

```bash
npx playwright test e2e/01-auth.spec.ts --project=chromium --reporter=line
```

Result:

- PASS (`6/6`)

Covered user-facing auth workflow cases:

1. valid login -> dashboard,
2. invalid credentials -> error path,
3. logout -> login route,
4. unauthenticated protected-route redirect,
5. role-aware sidebar boundary.
