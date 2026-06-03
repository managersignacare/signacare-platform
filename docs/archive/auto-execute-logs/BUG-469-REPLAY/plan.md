# Plan — BUG-469 REPLAY: authLimiter coverage + patient-app + upload + webhook limiters

[Plan agent invocation 2026-04-25 per `~/.claude/plans/sleepy-roaming-meteor.md` PART 2 §B; first-principles re-derivation per PART 6.1 #3 — no read of any reverted commit. Atomic-scope discipline per PART 11.]

**Severity:** S1 deploy-blocker (pre-staging)
**Replay queue position:** PART 1 Tier-3 #16 (after BUG-468)
**Sibling shipped at HEAD:** BUG-468 (`012dbee`) — added `cspReportRoutes` mounted at `/api/v1/csp-report`, inheriting `apiLimiter`. BUG-468's plan §9.6 noted a dedicated `cspReportLimiter` as a possible follow-up; **BUG-469 does NOT subsume that** — CSP-report is out of the named axes. Atomic scope per PART 11.

---

## 0. Executive summary

BUG-469's row reads: *"authLimiter coverage: mount at `/api/v1/auth` + patient-app + upload + webhook limiters."* Ground-truth confirms a real gap on **all four axes**:

| Axis | Current state | Risk class |
|---|---|---|
| `/api/v1/auth` | `authLimiter` mounted only at `/login` and `/mfa` (server.ts:258-259); `/refresh`, `/logout`, `/change-password`, `/verify-mfa-challenge`, `/verify-password-challenge`, `/break-glass/*`, `/admin/impersonate/*`, `/webauthn/*` get **only** `apiLimiter` (1000/min) | OWASP A07 brute-force on every credential-adjacent endpoint other than `/login` |
| Patient-app | `/login` and `/activate` (password-cracking + invite-redemption surfaces) have **only** `apiLimiter` | OWASP A07 brute-force against patient credentials + invite-code grinding |
| Upload | All multer-backed routes (`/patients/:id/attachments`, `/pathology`, `/legal-attachments`, alerts, imports, scribe streaming, referrals) get **only** `apiLimiter`; one client = ~1000 multipart writes/min, each up to 50 MB on streaming | DoS via storage / disk / S3 quota burn |
| Webhook | `POST /api/v1/webhooks/:source` gets **only** `apiLimiter` at IP layer. The DB-stored `rate_limit_per_minute` per-source check exists but only AFTER HMAC verify succeeds — pre-HMAC unauthenticated burst floor at 1000/min | OWASP A04 — pre-HMAC verification CPU burst |

**Out-of-scope (NOT touched):**
- BUG-472 (S2) — fail-closed-on-Redis-down policy. Current `redisStore()` fails open by design; BUG-472 re-evaluates.
- BUG-470 (S2) — Emotion nonce CSP refactor.
- A `cspReportLimiter` for the BUG-468 endpoint — different axis.
- LLM/AI/scribe non-upload routes — covered by `llmLimiter`.
- FHIR / billing / clinical-notes — correctly covered by `apiLimiter`'s 1000/min IP cap.

---

## 1. Current state — ground-truth Read

### 1.1 Limiter definitions and mounts — `apps/api/src/server.ts`

| Limiter | Defined | Mount sites | Cap |
|---|---|---|---|
| `apiLimiter` | 210-220 | `app.use('/api/', apiLimiter)` (261) | 600/min dev, 1000/min prod |
| `authLimiter` | 222-231 | `'/api/v1/auth/login'` (258), `'/api/v1/auth/mfa'` (259) | 200/15min dev, 10/15min prod |
| `llmLimiter` | 233-240 | `'/api/v1/llm'` (260) | 100/min dev, 50/min prod |

Backed by `redisStore()` (181-198) — fails open on `sendCommand` errors and falls back to memory store when Redis is unavailable. Skip-condition `req.path === '/health' || '/ready'` exists on `apiLimiter` (218).

### 1.2 `/api/v1/auth` mount surface — full enumeration

Routers mounted under `${API}/auth` or `${API}/admin/impersonate` (server.ts:507-519):

- `authRoutes` (507): `/csrf` GET (26), `/login` POST (39), `/mfa/verify` POST (40), `/refresh` POST (41), `/logout` POST (42), `/me` GET (43), `/change-password` POST (46), `/mfa/setup` POST (78), `/mfa/confirm` POST (109), `/mfa/disable` POST (126), `/mfa/status` GET (132), `/verify-mfa-challenge` POST (139), `/verify-password-challenge` POST (152).
- `breakGlassRoutes` (511): `/break-glass/{request,approve/:id,extend/:id,revoke/:id,active,audit}`.
- `adminImpersonationRoutes` (515): `POST /:staffId`, `POST /:id/end`, `GET /`.
- `webauthnRoutes` (519): `/webauthn/{register/options, register/verify, login/options, login/verify, credentials, credentials/:id}`.

ONLY `/login` and `/mfa/verify` (path matches `/mfa`) sit behind `authLimiter` today. Everything else gets `apiLimiter`'s 1000/min cap.

### 1.3 Patient-app surface — `apps/api/src/features/patient-app/patientAppRoutes.ts`

Mounted at server.ts:506. Two unauthenticated credential surfaces:
- `POST /activate` (262) — invite-code redemption + password set. Brute-force vector: invite enumeration.
- `POST /login` (347) — phone + password. Per-account `locked_until` (368) is independent of per-IP throttle.

### 1.4 Upload surface — multer-backed routes

| Route | Line | Cap |
|---|---|---|
| `patientRoutes.ts` `/:id/attachments` | 374 | 20 MB × 10 |
| `patientRoutes.ts` `/:id/pathology` | 471 | 20 MB × 1 |
| `patientRoutes.ts` `/:id/legal-attachments` | 879 | 20 MB × 5 |
| `patientRoutes.ts` `/alerts/:alertId/attachments` | 1014 | 20 MB × 5 |
| `importRoutes.ts` `/` | 52 | 10 MB |
| `streamingTranscribeRoutes.ts` stream-chunk/final | 36, 98 | 50 MB |
| `llmRoutes.ts` (audio transcribe) | 611-616 | 50 MB |
| `referralRoutes.ts` (attachment) | 229 | 10 MB |

All auth-gated, `apiLimiter` 1000/min only. Streaming routes (50 MB × 1000/min IP) = highest DoS leverage.

### 1.5 Webhook surface

- `POST /api/v1/webhooks/:source` (webhookRoutes.ts:83) — public, HMAC-authenticated, mounted at server.ts:766. Per-source `rate_limit_per_minute` enforced AFTER HMAC verify (lines 201-216). Pre-HMAC burst at `apiLimiter` 1000/min.
- `webhooks-admin/*` (server.ts:767) — admin-auth, low traffic.
- FHIR Subscription routes — staff-auth-gated, out of scope.

### 1.6 Existing rate-limit tests

`apps/api/tests/integration/rateLimiting.test.ts` — 3 cases: header-presence on `/auth/login`, behavioural 429 burst on `/auth/login`, header-presence on `/fhir/Patient`. **No** assertions on patient-app / upload / webhook.

### 1.7 BUG-469 catalogue row

`docs/quality/bugs-remaining.md:167` — state `open`.

---

## 2. Design — four limiters + targeted mounts

### 2.1 New limiter definitions (alongside existing in server.ts)

| Name | Window | Cap (dev / prod) | Rationale |
|---|---|---|---|
| `patientAuthLimiter` | 15 min | 200 / 10 | Mirrors `authLimiter` — brute-force defence on patient `/login` + `/activate` |
| `uploadLimiter` | 1 min | 200 / 30 | 30/min/IP × 50 MB = 1.5 GB/min ceiling per IP — clinical workflows fit, bulk-fill DoS doesn't |
| `webhookLimiter` | 1 min | 600 / 120 | 2/sec/IP for inbound public webhooks — well above legitimate per-partner rates, below CPU-burn DoS threshold |

All four use the same `redisStore()` SSoT, `standardHeaders: true, legacyHeaders: false`, and `normaliseIp` helper. Fail-open behaviour preserved (BUG-472 is the row that re-evaluates).

### 2.2 Mount changes — `apps/api/src/server.ts:258-261`

**Before:**
```ts
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/mfa', authLimiter);
app.use('/api/v1/llm', llmLimiter);
app.use('/api/', apiLimiter);
```

**After (illustrative — `apiLimiter` MUST stay LAST as catch-all):**
```ts
// BUG-469 — broaden authLimiter from /login + /mfa to ALL of /auth/*
// + admin/impersonate (credential-adjacent surface).
app.use('/api/v1/auth', authLimiter);
app.use('/api/v1/admin/impersonate', authLimiter);

// BUG-469 — dedicated patient-app brute-force / invite-grinding cap.
app.use('/api/v1/patient-app/login', patientAuthLimiter);
app.use('/api/v1/patient-app/activate', patientAuthLimiter);

// BUG-469 — dedicated upload throttle. Each is auth-gated; per-IP
// (not per-staff) so attackers can't spawn N sessions to dodge.
app.use('/api/v1/patients/:id/attachments', uploadLimiter);
app.use('/api/v1/patients/:id/pathology', uploadLimiter);
app.use('/api/v1/patients/:id/legal-attachments', uploadLimiter);
app.use('/api/v1/patients/alerts/:alertId/attachments', uploadLimiter);
app.use('/api/v1/imports', uploadLimiter);
app.use('/api/v1/scribe', uploadLimiter); // stream-chunk, stream-final, transcribe
app.use('/api/v1/referrals', uploadLimiter);

// BUG-469 — dedicated webhook IP limiter (pre-HMAC).
app.use('/api/v1/webhooks', webhookLimiter);

app.use('/api/v1/llm', llmLimiter);
app.use('/api/', apiLimiter);
```

Notes:
- `app.use('/api/v1/auth', authLimiter)` is a **prefix** mount — Express applies it to every path beginning with `/api/v1/auth`, including `/refresh`, `/logout`, `/change-password`, all break-glass, all webauthn (mounted at `${API}/auth`).
- `/api/v1/admin/impersonate` is separately top-level mounted (server.ts:515); separate limiter line.
- If Express prefix matching with `:id` doesn't bind cleanly, fallback is `router.use(uploadLimiter)` inside each route file. **TDD test reveals which form binds.**
- `apiLimiter` stays LAST — Express middleware order; specific limiters first.

### 2.3 Why mount at server.ts (not in route files)

Existing pattern (server.ts:258-260) — all 3 limiters mount at top-level `app`. Mounting in route files scatters policy + breaks SSoT. Exception: upload routes if Express prefix-matching with route params is brittle; L5 reviewer rules on the form.

### 2.4 No changes to existing limiters' caps

`apiLimiter` 1000/min, `authLimiter` 10/15min prod, `llmLimiter` 50/min — unchanged. This BUG ADDS limiters and EXPANDS authLimiter's mount path; does NOT retune existing thresholds.

### 2.5 Env vars for new limiter caps

| Var | Default dev / prod | Limiter |
|---|---|---|
| `PATIENT_AUTH_RATE_LIMIT` | 200 / 10 | `patientAuthLimiter` |
| `UPLOAD_RATE_LIMIT` | 200 / 30 | `uploadLimiter` |
| `WEBHOOK_RATE_LIMIT` | 600 / 120 | `webhookLimiter` |

Pattern: `parseInt(process.env.X ?? (isDev ? 'D' : 'P'), 10)` — mirrors server.ts:212/224/235.

---

## 3. TDD red plan — `apps/api/tests/integration/rateLimiting.test.ts` extension

### 3.1 New test cases (8 burst cases)

| # | Test | Pre-fix | Post-fix |
|---|---|---|---|
| L1 | authLimiter trips on `/api/v1/auth/refresh` in burst | No 429 in 250 attempts (apiLimiter cap > 250) | 429 within 200 attempts (authLimiter dev 200/15min) |
| L2 | authLimiter trips on `/api/v1/auth/change-password` in burst | No 429 in burst | 429 within 200 attempts |
| L3 | authLimiter trips on `/api/v1/auth/webauthn/login/options` in burst | No 429 in burst | 429 within 200 attempts |
| L4 | patientAuthLimiter trips on `/api/v1/patient-app/login` in burst | No 429 in burst | 429 within 200 attempts |
| L5 | patientAuthLimiter trips on `/api/v1/patient-app/activate` in burst | No 429 in burst | 429 within 200 attempts |
| L6 | uploadLimiter trips on `/api/v1/patients/<id>/attachments` in burst | No 429 in 250 attempts | 429 within 200 attempts (uploadLimiter dev 200/min) |
| L7 | uploadLimiter trips on `/api/v1/imports` in burst | No 429 in burst | 429 within 200 attempts |
| L8 | webhookLimiter trips on `/api/v1/webhooks/test-source` in burst | No 429 in burst (apiLimiter > 600/min) | 429 within ~600 attempts (webhookLimiter dev 600/min) |

### 3.2 Test discipline

- `vi.beforeEach` flushes `rl:*` Redis keys between tests.
- Use `request(app)` from supertest (rateLimiting.test.ts:21 precedent).
- Headers per route — `X-CSRF-Token: test`, `X-Client: mobile` for staff auth; `X-Client: patient-app` for patient-app per csrfMiddleware.ts:51.
- For upload tests: POST without body — multer 400s but the limiter still increments. **Or** mount limiter BEFORE multer.
- For webhook tests: hit `/api/v1/webhooks/test-source` with no body — receiver 400s (missing rawBody) but limiter increments first.
- Wrap each in `describe.skipIf(!READY)`.

### 3.3 §13.9 integration scope

server.ts touched → §13.9 fires → run **full integration suite** post-fix.

### 3.4 3× flake on the new file

PART 2 §F — `rateLimiting.test.ts` 3× post-fix; all GREEN.

### 3.5 Pre-fix expected failure shape

```
FAIL apps/api/tests/integration/rateLimiting.test.ts
  authLimiter on /api/v1/auth/refresh > L1 trips in burst
    AssertionError: expected saw429 to be true (was false after 250 requests)
```

---

## 4. Files modified

| File | Change |
|---|---|
| `apps/api/src/server.ts` | 3 new limiter defs; replace 2 narrow `authLimiter` mounts with 2 broader; 7 upload mount lines |
| `apps/api/tests/integration/rateLimiting.test.ts` | 8 new burst cases L1-L8 |
| `docs/quality/fix-registry.md` | 4 new anchor rows |
| `docs/quality/bugs-remaining.md` | Mark BUG-469 fixed (atomic with code commit per BUG-468 absorb-1) |

No new files. No new CI guard. No migration. No middleware/ touches outside server.ts.

---

## 5. Fix-registry anchors

| Row | File | Mode | Pattern | Description |
|---|---|---|---|---|
| `R-FIX-BUG-469-AUTH-LIMITER-MOUNT` | `apps/api/src/server.ts` | present | `app\.use\('/api/v1/auth', authLimiter\)` | `authLimiter` mounted at full `/api/v1/auth` prefix (was `/login` + `/mfa` only). |
| `R-FIX-BUG-469-PATIENT-APP-AUTH-LIMITER` | `apps/api/src/server.ts` | present | `patientAuthLimiter` | Patient-app brute-force limiter mounted at `/login` + `/activate`. |
| `R-FIX-BUG-469-UPLOAD-LIMITER` | `apps/api/src/server.ts` | present | `uploadLimiter` | Upload throttle on patient/imports/scribe/referrals. |
| `R-FIX-BUG-469-WEBHOOK-LIMITER` | `apps/api/src/server.ts` | present | `webhookLimiter` | Public-webhook IP limiter pre-HMAC. |

All `present`-mode regression-traps.

---

## 6. L4 / L5 conditional triggers

### 6.1 L4 — **DOES NOT FIRE**

Per §13.5 — no path or semantic trigger. Rate limiters are infrastructure, not patient-safety / consent / allergy / prescribing / risk / MHA / module-access. No fail-open ↔ fail-closed transition (preserved per BUG-472 scoping). No audit-log write-path modification.

### 6.2 L5 — **FIRES**

Per §I — touches `apps/api/src/server.ts` (top-level middleware boot + rate-limit config) AND modifies `fix-registry.md`. L5 verifies:
- Redis keying scheme matches existing precedent (`rl:<scope>:<ip>`).
- Mount ordering (specific → general) so `apiLimiter` doesn't shadow.
- `redisStore()` SSoT reused.
- Fail-open-on-Redis-down policy unchanged; BUG-472 still owns that re-evaluation.
- Express prefix matching with `:id` route params binds correctly OR scope-local fallback.
- Atomic scope: 4 axes, not 5.

### 6.3 L3 — fires unconditionally.

### 6.4 L1 / L2 — runs as standard.

---

## 7. PART 2 §A-§O execution map

§A done. §B done. §C TDD red. §D Implementation. §E L1. §F L2 (3× flake + full integration §13.9). §G L3. §H L4 NOT invoked. §I L5. §J 2-REJECT absorb cap. §K fix-registry. §L commit (atomic with bugs-remaining flip per BUG-468 absorb-1 lesson). §M chore commit with SHA + progress.md. §N push (after explicit auth). §O.

---

## 8. Verification log — every cited site Read-confirmed

| Item | File | Line |
|---|---|---|
| BUG-469 row | `docs/quality/bugs-remaining.md` | 167 |
| `apiLimiter` def | `apps/api/src/server.ts` | 210-220 |
| `authLimiter` def | `apps/api/src/server.ts` | 222-231 |
| `llmLimiter` def | `apps/api/src/server.ts` | 233-240 |
| Existing limiter mounts | `apps/api/src/server.ts` | 258-261 |
| `redisStore()` SSoT | `apps/api/src/server.ts` | 181-198 |
| auth router mounts | `apps/api/src/server.ts` | 507, 511, 515, 519 |
| patient-app mount | `apps/api/src/server.ts` | 506 |
| webhooks public mount | `apps/api/src/server.ts` | 766 |
| authRoutes endpoints | `apps/api/src/features/auth/authRoutes.ts` | 26, 39-43, 46, 78, 109, 126, 132, 139, 152 |
| breakGlass + adminImpersonation + webauthn endpoints | various | (per §1.2) |
| patient-app `/activate` + `/login` | `apps/api/src/features/patient-app/patientAppRoutes.ts` | 262, 347 |
| Multer routes | `apps/api/src/features/{patients,imports,llm,referrals}/...` | (per §1.4) |
| Webhook public POST + DB rate cap | `apps/api/src/features/webhooks/webhookRoutes.ts` | 83, 201-216 |
| Existing rate-limit tests | `apps/api/tests/integration/rateLimiting.test.ts` | 1-121 |

---

## 9. Risks + open questions

1. **Express prefix matching with `:id`.** `app.use('/api/v1/patients/:id/attachments', uploadLimiter)` — accepts path patterns but route-param semantics differ slightly from `router.<verb>`. **Mitigation:** TDD test reveals; fallback is `router.use(uploadLimiter)` inside each route file.
2. **Test budget.** 8 burst tests × 200+ requests = ~1600 round-trips, ~4 min. Per-test 60_000 ms timeout extension may be needed.
3. **Redis key collision.** `vi.beforeEach` must `redis.del('rl:*')`.
4. **`/api/v1/admin/impersonate` axis classification.** Plan adds explicit limiter line; L5 may agree (credential-adjacent) or want it in a separate axis.
5. **Webhook routes at `integrations/fhir/fhirSubscription.ts` + `integrations/outlook/outlookRoutes.ts`** — auth-gated, out of named scope.
6. **`/api/v1/webhooks-admin`** — admin-auth, covered by `apiLimiter`. Out of scope unless L5 says.
7. **Streaming transcribe DoS (1.5 GB/min/IP)** — even with new limiter. Tighter cap may be follow-up if staging surfaces it.

---

## 10. Out-of-scope follow-ups (PART 3 if surfaced)

- BUG-469-FU candidates: tighter `uploadLimiter` for streaming routes; `cspReportLimiter`; `webhooks-admin` limiter; per-staff (not per-IP) auth limiter.
- Already-filed siblings NOT touched: BUG-472 (Redis fail-closed), BUG-470 (Emotion CSP).

**Atomic scope: 4 axes, not 5.**

---

## 11. Critical Files

- `apps/api/src/server.ts` (modify — 3 limiter defs + mount edits)
- `apps/api/tests/integration/rateLimiting.test.ts` (modify — 8 new burst cases)
- `docs/quality/fix-registry.md` (modify — 4 anchor rows)
- `docs/quality/bugs-remaining.md` (modify — mark BUG-469 fixed atomic with code commit)
