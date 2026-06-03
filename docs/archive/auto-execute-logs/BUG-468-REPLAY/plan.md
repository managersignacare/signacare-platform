# Plan — BUG-468 REPLAY: CSP Directive Gaps + `report-uri` Endpoint

[Plan agent invocation 2026-04-25 per `~/.claude/plans/sleepy-roaming-meteor.md` PART 2 §B; first-principles re-derivation per PART 6.1 #3 — no read of reverted commit `7e838e9`.]

**Severity:** S1 deploy-blocker (pre-staging)
**Reverted commit (do NOT re-read):** `7e838e9` — superseded by atomic revert `a475e32` 2026-04-24
**Replay queue position:** PART 1 Tier-3 #15 (after BUG-463)
**Sibling shipped at HEAD:** BUG-463 (`0c44896`) — JWT-payload discriminated union; orthogonal to this BUG.

---

## 0. Executive summary — the BUG title is misleading; verify before fixing

**Critical finding from helmet 8 source read** (`node_modules/helmet/index.cjs:1-130`): helmet 8's CSP middleware behaves with `useDefaults = true` by default, and merges the following defaults whenever the user's `directives` object does NOT explicitly contain them:

```js
const getDefaultDirectives = () => ({
  "default-src": ["'self'"],
  "base-uri": ["'self'"],            // ← claimed "missing" — actually emitted
  "font-src": ["'self'", "https:", "data:"],
  "form-action": ["'self'"],         // ← claimed "missing" — actually emitted
  "frame-ancestors": ["'self'"],
  "img-src": ["'self'", "data:"],
  "object-src": ["'none'"],          // ← claimed "missing" — actually emitted
  "script-src": ["'self'"],
  "script-src-attr": ["'none'"],
  "style-src": ["'self'", "https:", "'unsafe-inline'"],
  "upgrade-insecure-requests": []    // ← claimed "missing" — actually emitted
})
```

So 4 of the 5 directives BUG-468 names (`base-uri`, `object-src`, `form-action`, `upgrade-insecure-requests`) are ALREADY on the wire today. Only `report-uri` is genuinely absent.

**This does NOT make BUG-468 a no-op.** Three reasons it must still be fixed:

1. **Defence-in-depth via explicit-tagging.** A future contributor who adds `useDefaults: false` (a common helmet pattern when CSP is heavily customised) silently drops all 5 baseline directives in a single line change. Pinning EXPLICITLY + fix-registry `present`-mode regression-traps closes this footgun.

2. **`report-uri` is genuinely missing.** Without it CSP violations are dropped on the floor — no observability if a future PR weakens a directive or introduces a third-party asset that violates policy.

3. **Audit semantics.** Pre-staging closure requires the catalogue row to flip to `**fixed**`. The honest closure is to make the implicit explicit AND add the missing report endpoint.

Per PART 6.1 #2 (gold-standard fix) and #5 (no guessing), the plan is grounded in the actual emitted header.

---

## 1. Current state — ground-truth Read

### 1.1 Helmet config — `apps/api/src/server.ts:280-303`

```ts
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...cdnHosts],
        styleSrc: ["'self'", "'unsafe-inline'", ...cdnHosts],
        imgSrc: ["'self'", 'data:', ...cdnHosts],
        fontSrc: ["'self'", 'data:', ...cdnHosts],
        connectSrc: ["'self'", ...cdnHosts, ...(isDev ? ['http://localhost:*'] : [])],
        frameAncestors: ["'self'"],
      },
    },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  }),
);
```

`cdnHosts` is the `CDN_HOSTS` env-var-driven allowlist defined at `server.ts:263-278`. No `useDefaults` key — defaults active. No `report-uri`.

### 1.2 What's actually emitted on the wire

After helmet's merge, the response carries:

```
default-src 'self';
script-src 'self' [cdnHosts];
style-src 'self' 'unsafe-inline' [cdnHosts];
img-src 'self' data: [cdnHosts];
font-src 'self' data: [cdnHosts];
connect-src 'self' [cdnHosts];
frame-ancestors 'self';
base-uri 'self';                 ← from helmet defaults
form-action 'self';              ← from helmet defaults
object-src 'none';               ← from helmet defaults
script-src-attr 'none';          ← from helmet defaults
upgrade-insecure-requests        ← from helmet defaults
```

`report-uri` and `report-to` absent.

### 1.3 Existing test coverage — `apps/api/tests/integration/securityHeaders.test.ts:34-43`

Only 2 assertions: `default-src 'self'` + `frame-ancestors 'self'`. No assertion on `base-uri / object-src / form-action / upgrade-insecure-requests / report-uri`.

### 1.4 No prior csp-report endpoint

`Glob apps/api/src/features/**/cspReport*` → 0 hits. Endpoint must be NEW.

### 1.5 No `<base href>`, `<form action="…">`, `<object>`, `<embed>` in the SPA

Verified — no breakage from making the 4 helmet-default directives explicit.

### 1.6 Logger SSoT, rate-limiter SSoT, BUG-468 row

- Logger: `apps/api/src/utils/logger.ts` pino with PHI redaction.
- Rate limiter: `apiLimiter` (1000/min) at `server.ts:261` covers `/api/*`.
- Row at `docs/quality/bugs-remaining.md:165` — state `open`.

---

## 2. Design — explicit directives + `/csp-report` endpoint

### 2.1 The 5 directive additions

| Directive | Value | Source today | After |
|---|---|---|---|
| `base-uri` | `'self'` | helmet default | EXPLICITLY pinned in `server.ts` |
| `object-src` | `'none'` | helmet default | EXPLICITLY pinned |
| `form-action` | `'self'` | helmet default | EXPLICITLY pinned |
| `upgrade-insecure-requests` | `[]` (token-only) | helmet default | EXPLICITLY pinned |
| `report-uri` | `['/api/v1/csp-report']` | NOT emitted | NEW |

### 2.2 New CSP-report endpoint — `apps/api/src/features/security/cspReportRoutes.ts` (NEW)

**Route:** `POST /api/v1/csp-report`

**Authentication:** NONE (browser sends violations unauthenticated per W3C spec).

**Body parser:** legacy `application/csp-report` MIME (Chrome) + `application/json` (Firefox). Add `express.json({ type: ['application/csp-report', 'application/json'] })` SCOPED to this route only.

**Schema:** legacy `report-uri` shape with `.passthrough()` for vendor-extended fields:

```ts
const CspReportSchema = z.object({
  'csp-report': z.object({
    'document-uri': z.string().optional(),
    'referrer': z.string().optional(),
    'violated-directive': z.string(),
    'effective-directive': z.string().optional(),
    'original-policy': z.string().optional(),
    'disposition': z.string().optional(),
    'blocked-uri': z.string().optional(),
    'line-number': z.number().optional(),
    'column-number': z.number().optional(),
    'source-file': z.string().optional(),
    'status-code': z.number().optional(),
    'script-sample': z.string().optional(),
  }).passthrough(),
}).passthrough();
```

**Response:** `204 No Content`.

**Observability:** structured pino `warn` log with `type: 'csp_violation'`, picked fields only (no raw body — avoids PHI footgun).

**Persistence:** LOG ONLY for BUG-468. `csp_violations` table is a follow-up if observability gaps surface.

**Rate limiting:** inherits `apiLimiter` (1000/min/IP).

**Body-size cap:** global `express.json({ limit: '2mb' })` applies.

### 2.3 Updated server.ts directives block (illustrative)

```ts
contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", ...cdnHosts],
    styleSrc: ["'self'", "'unsafe-inline'", ...cdnHosts],
    imgSrc: ["'self'", 'data:', ...cdnHosts],
    fontSrc: ["'self'", 'data:', ...cdnHosts],
    connectSrc: ["'self'", ...cdnHosts, ...(isDev ? ['http://localhost:*'] : [])],
    frameAncestors: ["'self'"],
    // BUG-468 — pin defence-in-depth directives EXPLICITLY so a future
    // commit cannot silently drop them by adding `useDefaults: false`.
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    formAction: ["'self'"],
    upgradeInsecureRequests: [],
    // BUG-468 — observability hook for any directive violation.
    reportUri: ['/api/v1/csp-report'],
  },
},
```

Helmet's `dashify` converts camelCase → kebab-case at normalize time — verified at `node_modules/helmet/index.cjs:20`.

### 2.4 Route mount — `apps/api/src/server.ts`

Insert near the public branding/FHIR-metadata block at `server.ts:452-485`, BEFORE `roleFeatureRoutes` (which applies authMiddleware).

```ts
import cspReportRoutes from './features/security/cspReportRoutes';
app.use(`${API}/csp-report`, cspReportRoutes);
```

---

## 3. TDD red plan

### 3.1 Extend `apps/api/tests/integration/securityHeaders.test.ts` — 5 new assertions (H7-H11)

| # | Assertion | Pre-fix |
|---|---|---|
| H7 | CSP contains `base-uri 'self'` | PASS today (helmet default) — regression-trap if useDefaults flipped |
| H8 | CSP contains `object-src 'none'` | PASS today — same trap |
| H9 | CSP contains `form-action 'self'` | PASS today — same trap |
| H10 | CSP contains `upgrade-insecure-requests` | PASS today — same trap |
| H11 | CSP contains `report-uri /api/v1/csp-report` | **FAIL pre-fix** → PASS post-fix |

H7-H10 are RED-traps. H11 is the behavioural pass/fail flip.

### 3.2 New `apps/api/tests/integration/cspReport.int.test.ts` (NEW) — 6 cases

| # | Test | Expected |
|---|---|---|
| C1 | POST valid `application/csp-report` body | 204 |
| C2 | Logger emits structured `csp_violation` warn | log payload contains expected fields |
| C3 | POST with `application/json` MIME | 204 |
| C4 | POST with malformed body (no `csp-report` key) | 400 (Zod fail) |
| C5 | POST without auth headers | 204 — confirms unauthenticated by design |
| C6 | Vendor-extended fields don't break parse | 204 |

3× flake on the new file.

### 3.3 Pre-fix expected failure shape

```
FAIL apps/api/tests/integration/cspReport.int.test.ts
  Cannot find module '../../src/features/security/cspReportRoutes'
```

```
FAIL apps/api/tests/integration/securityHeaders.test.ts > emits report-uri
  AssertionError: expected '...' to contain 'report-uri /api/v1/csp-report'
```

### 3.4 Test discipline per §13.9

server.ts is touched (top-level middleware) → §13.9 trigger fires → run FULL integration suite.

---

## 4. Files modified

| File | Change |
|---|---|
| `apps/api/src/server.ts` | Add 5 explicit directives + import + mount cspReportRoutes |
| `apps/api/src/features/security/cspReportRoutes.ts` | NEW — POST `/csp-report` handler + Zod + structured log |
| `apps/api/tests/integration/securityHeaders.test.ts` | UPDATE — 5 new assertions |
| `apps/api/tests/integration/cspReport.int.test.ts` | NEW — 6 cases |
| `docs/quality/fix-registry.md` | Add 3 new anchor rows |
| `docs/quality/bugs-remaining.md` | Mark BUG-468 fixed |

No migration. No new CI guard.

---

## 5. Fix-registry anchors

| Row | File | Mode | Pattern | Description |
|---|---|---|---|---|
| `R-FIX-BUG-468-CSP-DIRECTIVES` | `apps/api/src/server.ts` | present | `baseUri:.*objectSrc:.*formAction:.*upgradeInsecureRequests:.*reportUri:` (multi-line) | All 5 BUG-468 directives pinned EXPLICITLY in helmet config. Trap fires if any key removed. |
| `R-FIX-BUG-468-CSP-REPORT-ROUTE` | `apps/api/src/features/security/cspReportRoutes.ts` | present | `router\.post\('/'` | Endpoint registration anchor. |
| `R-FIX-BUG-468-CSP-REPORT-MOUNT` | `apps/api/src/server.ts` | present | `csp-report.*cspReportRoutes` | Route mounted at expected path — defence vs typo/rename desync from `report-uri` directive. |

---

## 6. L4 / L5 conditional triggers

### 6.1 L4 — **DOES NOT FIRE**

Per §13.5 — neither path nor semantic trigger fires. CSP is browser security, not patient-safety / consent / allergy / prescribing / risk / MHA / module-access. No fail-open ↔ fail-closed transition. No audit-log write-path modification.

### 6.2 L5 — **FIRES**

Per §I — touches `apps/api/src/server.ts` (top-level boot wiring including helmet middleware mount), creates new feature route module, AND modifies `fix-registry.md`. L5 must verify the explicit-directives + fix-registry-anchor design closes the helmet useDefaults footgun, the new `features/security/` directory layout, mount-order with `roleFeatureRoutes`, legacy `report-uri` vs modern `report-to`, and `apiLimiter` sufficiency.

### 6.3 L3 — fires unconditionally.

### 6.4-6.5 L1 / L2 — runs as standard.

---

## 7. PART 2 §A-§O execution map

§A done. §B done. §C TDD red — extend `securityHeaders.test.ts` + write `cspReport.int.test.ts`. Run 3×, confirm RED for H11 + C1-C6. §D Implementation — add 5 directives + create `cspReportRoutes.ts` + mount. §E L1. §F L2. §G L3. §H L4 NOT invoked. §I L5. §J 2-REJECT absorb cap. §K fix-registry. §L commit. §M bugs-remaining + yaml. §N push (after explicit auth). §O progress.md.

---

## 8. Verification log — every cited site Read-confirmed

| Item | File | Line/Source |
|---|---|---|
| BUG-468 row | `docs/quality/bugs-remaining.md` | 165 |
| Helmet config | `apps/api/src/server.ts` | 280-303 |
| `cdnHosts` | `apps/api/src/server.ts` | 263-278 |
| Existing CSP test | `apps/api/tests/integration/securityHeaders.test.ts` | 34-43 |
| Helmet 8 default merge | `node_modules/helmet/index.cjs` | 1-130, esp. 7-19, 78-83 |
| Helmet dashify | `node_modules/helmet/index.cjs` | 20 |
| Helmet version | `apps/api/package.json` | `"helmet": "^8.0.0"` |
| `apiLimiter` mount | `apps/api/src/server.ts` | 210-220, 261 |
| `express.json({ limit: '2mb' })` | `apps/api/src/server.ts` | 337-346 |
| `roleFeatureRoutes` | `apps/api/src/server.ts` | 500-502 |
| Logger SSoT | `apps/api/src/utils/logger.ts` | 1-86 |
| `index.html` no `<base>` | `apps/web/index.html` | 1-27 |
| No `<form action>` in SPA | `apps/web/src/**` | grep |
| No prior CSP-report code | `apps/api/src/**/cspReport*` | Glob 0 hits |
| No prior `features/security/` | `apps/api/src/features/security/` | Glob 0 hits |

---

## 9. Risks + open questions

1. **`upgrade-insecure-requests` in dev** — directive auto-upgrades `http://` references EXCEPT for "potentially trustworthy" hosts (localhost included). No dev breakage.
2. **`script-src-attr 'none'`** — currently inherited from helmet defaults. Could be pinned for parity with the 5 BUG-468 directives — file as **BUG-468-FU** if L5 surfaces it.
3. **Modern `Report-To` header + `report-to` directive** — Chrome 96+ prefers it. BUG-468 names `report-uri` (legacy) which most browsers still honour. **BUG-468-FU follow-up:** add `Report-To` JSON header + `reportTo` directive.
4. **No persistence layer** — file as a follow-up if staging volume warrants.
5. **PHI in CSP report payloads** — patient UUIDs are NOT PHI per `apps/api/src/utils/phiFields.ts`; structured-log only documented fields, not raw `req.body`.
6. **CSP-report DDoS amplifier** — `apiLimiter` caps 1000/min/IP. If observed in staging, dedicated `cspReportLimiter` is the follow-up.
7. **Test C2 mocking pino** — use `vi.spyOn(logger, 'warn')` per existing `loggerRedaction.test.ts` precedent.

---

## 10. Out-of-scope follow-ups

Created only if surfaced by reviewers, NOT speculatively:

- **BUG-468-FU candidates:** persistent `csp_violations` table, modern `Report-To` header, dedicated `cspReportLimiter`, `script-src-attr 'none'` pinning.

---

## 11. Critical Files

- `apps/api/src/server.ts` (modify — 5 explicit CSP directives + mount cspReportRoutes)
- `apps/api/src/features/security/cspReportRoutes.ts` (NEW — POST `/csp-report` handler)
- `apps/api/tests/integration/securityHeaders.test.ts` (modify — H7-H11 assertions)
- `apps/api/tests/integration/cspReport.int.test.ts` (NEW — 6 cases)
- `docs/quality/fix-registry.md` (modify — 3 anchor rows)
