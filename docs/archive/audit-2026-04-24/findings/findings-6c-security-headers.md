# Findings 6c — HTTP security headers

**Agent:** G-headers
**Scope:** `apps/api/src/server.ts`, `apps/api/src/middleware/*`, `apps/api/src/config/*`.
**Live probe:** `curl -I http://localhost:4000/health` captured at `docs/archive/audit-2026-04-24/probes/security-headers.txt`.

## Inventory (what's in place)

| Item | Value | Evidence |
|---|---|---|
| `trust proxy` | `1` when `TRUST_PROXY=1` or `NODE_ENV=production` | `server.ts:147-151` |
| `helmet()` | Mounted before routes | `server.ts:280-303` |
| CSP | Configured (see §3) | `server.ts:282-298` |
| `hsts` | `maxAge: 63072000` (2y), `includeSubDomains: true`, `preload: true` | `server.ts:299` |
| `referrerPolicy` | `strict-origin-when-cross-origin` | `server.ts:300` |
| `X-Content-Type-Options` | `nosniff` | `server.ts:312` |
| `X-Frame-Options` | `DENY` | `server.ts:313` |
| `X-XSS-Protection` | `'0'` (deliberately disabled, CSP-preferred) | `server.ts:314` |
| `Permissions-Policy` | `camera=(), microphone=(self), geolocation=(), payment=()` | `server.ts:315` |
| `X-Powered-By` | Removed | `server.ts:316` |
| CORS | Static list from `CORS_ORIGIN` env, `credentials: true`, explicit methods/headers | `server.ts:320-328` |
| `express.json` | `'2mb'` with webhook rawBody capture | `server.ts:337-346` |
| Auth cookies | `httpOnly: true, secure: isProd, sameSite: 'strict', path: '/'` | `authController.ts:36-45` |
| `apiLimiter` | 1000/min prod (600 dev) on `/api/` | `server.ts:210-220` |
| `authLimiter` | 10/15min prod on `/auth/login` + `/auth/mfa` | `server.ts:222-231` |
| `llmLimiter` | 50/min prod on `/api/v1/llm` | `server.ts:233-240` |
| CSRF | Custom header + Redis synchronizer token | `csrfMiddleware.ts` |
| IP allowlist | Opt-in via `IP_ALLOWLIST` env (CIDR) | `ipAllowlist.ts` |

**Posture:** very good overall — full helmet suite + HSTS preload + strict Permissions-Policy + proper cookie flags + three-tier rate limiting.

## Gaps

| # | Gap | Severity | Evidence |
|---|---|---|---|
| G1 | CSP `styleSrc` includes `'unsafe-inline'` (MUI/Emotion) | Medium | `server.ts:292` |
| G2 | CSP missing `base-uri`, `object-src`, `form-action`, `upgrade-insecure-requests` | Medium | `server.ts:282-298` |
| G3 | CSP has no `report-uri`/`report-to` — violations silent | Medium | same |
| G4 | No upload-specific rate limiter — multipart shares global 1000/min | Medium | `server.ts:210-220` |
| G5 | No dedicated limiter on `/api/v1/webhooks/:source` (unauthenticated inbound) | Medium | `server.ts:745` |
| G6 | `authLimiter` covers only `/auth/login` + `/auth/mfa`. `/auth/refresh`, `/auth/break-glass`, `/auth/webauthn/*`, `/admin/impersonate` fall back to 1000/min | **Medium-High** | `server.ts:258-259, 489-498` |
| G7 | Public `/patient-app/activate` + `/patient-app/login` inherit only `apiLimiter` — brute-force surface | Medium | `server.ts:485` |
| G8 | `imgSrc`/`fontSrc` include `data:` — DOM exfil channel | Low | `server.ts:293-294` |
| G9 | `TRUST_PROXY` is boolean, fixed to 1 hop — Azure Front Door + App Service is 2 hops | Low | `server.ts:147-151` |
| G10 | `CORS_ORIGIN` default `http://localhost:5173`; prod mis-config only warns, doesn't abort | Low-Medium | `config.ts:26, 84` |
| G11 | `API_RATE_LIMIT` / `AUTH_RATE_LIMIT` env overrides have no lower bound | Low | `server.ts:212, 224` |
| G12 | `Cross-Origin-Resource-Policy` / `COOP` / `COEP` not explicitly set (helmet defaults) | Low | `server.ts:280-303` |
| G13 | Rate-limit Redis store fails open to per-instance memory; multi-instance App Service silently multiplies limits | **Medium** | `server.ts:181-198` |

## CSP audit

| Directive | Value | Flag |
|---|---|---|
| `default-src` | `'self'` | OK |
| `script-src` | `'self'` + `cdnHosts` | OK (no `unsafe-inline`/`unsafe-eval`) |
| `style-src` | `'self'` + **`'unsafe-inline'`** + `cdnHosts` | MUI/Emotion — documented |
| `img-src` | `'self'` + **`data:`** + `cdnHosts` | `data:` permitted |
| `font-src` | `'self'` + **`data:`** + `cdnHosts` | `data:` permitted |
| `connect-src` | `'self'` + `cdnHosts` + dev-only `http://localhost:*` | OK |
| `frame-ancestors` | `'self'` | OK |
| `base-uri`, `object-src`, `form-action`, `upgrade-insecure-requests`, `report-uri` | **missing** | Gaps |

No wildcards, no `unsafe-eval`.

## Top-5 highest-severity gaps

1. **CSP missing `base-uri, object-src, form-action, upgrade-insecure-requests, report-uri`** — add all five to close `<base>` rewrites, plugin embeds, form exfil, mixed content, silent violations.
2. **`authLimiter` covers only `/auth/login` + `/auth/mfa`** — refresh, break-glass, WebAuthn, admin-impersonation, and public patient-app activate/login sit on 1000/min global limiter. Move mount to `/api/v1/auth` (skip `/auth/csrf`) and add separate limiter for `/api/v1/patient-app`.
3. **CSP `styleSrc 'unsafe-inline'`** — wire Emotion to nonce-based `CacheProvider`; helmet supports per-request nonces via directive function.
4. **No upload-specific or webhook-specific limiter** — multipart 2MB × 1000/min = 2 GB/min/IP; public webhook POSTs spend HMAC CPU per request regardless of signature validity. Add `uploadLimiter` (20/min/IP) and `webhookLimiter` (120/min/IP + 600/min/`:source`).
5. **`CORS_ORIGIN` falls back with warn-only in prod** — promote to `process.exit(1)` when `NODE_ENV=production` + unset-or-localhost, matching existing `assertProductionIntegrationsConfigured` pattern.

## Azure-specifics

- Front Door + App Service = 2 proxy hops; `TRUST_PROXY` must be parametrised to integer, not boolean
- Layer WAF OWASP ruleset ahead of helmet for defence-in-depth
- Confirm `minTlsVersion: 1.2` and `WEBSITE_DISABLE_HTTPS=false` on App Service
- Submit apex to `hstspreload.org` once Azure DNS cuts over

## Related BUGs

- **BUG-468 (S1)** (new) — CSP directive gaps: `base-uri, object-src, form-action, upgrade-insecure-requests, report-uri` missing
- **BUG-469 (S1)** (new) — authLimiter coverage: mount at `/api/v1/auth` + add patient-app limiter + upload + webhook limiters (G6 + G7 + G4 + G5)
- **BUG-470 (S2)** (new) — Emotion nonce-based CacheProvider to drop `styleSrc 'unsafe-inline'` (G1)
- **BUG-471 (S2)** (new) — `TRUST_PROXY` integer parametrisation for Azure 2-hop
- **BUG-472 (S2)** (new) — rate-limit fail-closed policy on Redis down for auth routes (G13)
- **BUG-473 (S3)** (new) — CORS_ORIGIN prod fallback promote warn → exit (G10)
