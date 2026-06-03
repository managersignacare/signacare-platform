# BUG-032 — Playwright probe login hang after ~7 iterations (session-cap + rate-limiter thrash)

> Plan doc authored at end of propose → review → execute cycle, co-committed with the fix.

## 1. Metadata

| | |
|---|---|
| Severity | S1 |
| Track | A |
| Wave | A-1 (critical blockers) |
| Change-class | standard (test infra; ≤100 LOC across probe specs + fixtures; no product code, schema, or dep changes) |
| Commit SHA | _pending_ |
| Fix-registry anchor | R-FIX-E2E-STORAGE-STATE-LOGIN |
| Discovered | pre-plan (bug-catalogue.md §Phase II probes, discovered via route-crawler.spec.ts) |
| Closed | _pending_ |

## 2. Diagnosis

**Root cause:** Probe E2E specs (`e2e/probes/*.spec.ts`) invoke `loginAs(page, 'admin')` inside `beforeEach` under `test.describe.configure({ mode: 'serial' })`. Each of ~50 routes in the crawler therefore triggers a fresh UI POST `/api/v1/auth/login`. After ~7 iterations the combination of the per-user 5-session cap ([authService.ts:160-172](../../apps/api/src/features/auth/authService.ts#L160-L172)) and the `/auth/login` rate-limiter bucket ([server.ts:191-200](../../apps/api/src/server.ts#L191-L200)) causes the login POST to hang without surfacing an HTTP error. The UI is stuck at `/login` with the sign-in button in `Loading` state; `page.waitForURL('**/dashboard', { timeout: 15_000 })` times out. Symptom reproduced locally: probe suite runs 7 passes then fails at the 8th test (`/drafts`) with the captured page snapshot showing `progressbar "Loading"` under a disabled Sign-in button.

**Classification:** **structural** — root cause is the test pattern (50 UI logins per suite), not a product auth bug. Login returns `{ requiresMfa: false, mustChangePassword: false }` for admin (verified via `curl -s -X POST http://localhost:4000/api/v1/auth/login ...`). "Fix the loginAs helper" is a band-aid; "stop re-logging in 50 times per suite" is the gold-standard fix.

**Other instances:** grep confirmed 8 probe specs use `loginAs` in `beforeEach` or at start of `test()`; other E2E suites either use the extended `test` fixture's `authedPage` (which also calls `loginAs` once per file but does not cascade the same way) or use direct login in `01-auth.spec.ts` which explicitly tests the login UI flow.

## 3. Approach

**Gold-standard fix:** Playwright `globalSetup` + `storageState` per user. One UI login per test run, reused via `test.use({ storageState })` across probe files.

**Downstream impact:**
- Probe suites no longer thrash MAX_SESSIONS or the rate-limiter — one login per role per test run instead of 50×.
- `01-auth.spec.ts` preserved using direct `loginAs` — that file literally tests the login UI.
- Production auth behaviour untouched: session-cap, rate limiter, MFA gates all unchanged.

**Pattern cited:** Playwright documented authentication pattern (`globalSetup` writing per-user storage state files, tests declaring `test.use({ storageState: 'path' })`).

## 4. Alternatives considered + rejected

| Alternative | Rejected because |
|---|---|
| Make `loginAs` "robust" — retry `waitForURL`, handle intermediate redirects to `/mfa` or `/change-password` | Band-aid; papers over the 50-login-per-suite anti-pattern and leaves the session-cap + rate-limiter time-bomb for the next developer |
| Relax `MAX_SESSIONS` for dev / disable rate-limiter when `NODE_ENV=test` | Introduces divergence between test and production auth behaviour — violates CLAUDE.md §13 fail-loud and "never deviate from gold standards" |
| Bypass UI login entirely by injecting session cookies via `dbAdmin` | Skips the HTTP login path — would not catch a real auth regression introduced later |
| Delete the `beforeEach(loginAs)` and rely on the existing extended `test.authedPage` fixture alone | Fixture login runs per test too — same session thrash, smaller blast radius but not resolved |

## 5. Reviewer refinement trail

**Round 1 — REFINED with four points:**

1. **sessionStorage NOT persisted by storageState.** Reviewer's technical correction — verified against `node_modules/playwright-core/types/types.d.ts:9287-9329`: storageState captures cookies + localStorage + (optionally) IndexedDB, NOT sessionStorage. My initial draft wrote `sessionStorage.setItem('tour-dismissed', 'true')` in globalSetup, which would NOT carry into probe test contexts. **ACCEPTED.** Fix: `context.addInitScript(() => sessionStorage.setItem('tour-dismissed', 'true'))` applied automatically via an extended-test context fixture so the init script re-runs on every page load in every authenticated context.

2. **Catalogue authoritative-row concern.** Reviewer: "don't invent a parallel duplicate row." Verified: BUG-032 appears in `bug-catalogue-v2.yaml` ONE time only — as a closure-note reference inside BUG-004. There is no existing full row to duplicate. My plan PROMOTES the indirect reference to a full YAML row. **CLARIFIED** with explicit language in commit body: "BUG-032 promoted from indirect reference in BUG-004 closure note to full catalogue row."

3. **"admin.json has cookies" smoke test too implementation-shaped.** Reviewer wanted a behavioural assertion. **ACCEPTED.** Replaced with two assertions: (a) protected route loads without /login redirect or login POST; (b) authenticated user email renders in the UI.

4. **Explicit auth-directory creation.** Reviewer: first-run failures should signal auth, not filesystem noise. **ACCEPTED.** Added `fs.mkdirSync('e2e/.auth', { recursive: true })` at globalSetup start + post-login URL assertion + loud throw with screenshot path if globalSetup fails.

## 6. Implementation outline

**Files touched:**

- **New** `e2e/fixtures/global-setup.ts` — one UI login per user (admin, clinician, manager); writes per-user storage state JSON files under `e2e/.auth/`.
- `e2e/fixtures/auth.ts` — extended `test` gains a `context` fixture that applies `addInitScript` for `sessionStorage.setItem('tour-dismissed', 'true')` to every new page so probe tests never see `GuidedTourOverlay`. `loginAs` retained for `01-auth.spec.ts`.
- `playwright.config.ts` — adds `globalSetup` pointing at `./e2e/fixtures/global-setup.ts`.
- `.gitignore` — adds `e2e/.auth/` (storage state files contain session tokens, must not be committed).
- `e2e/probes/*.spec.ts` (8 files: `button-smoke`, `chaos`, `save-round-trip`, `api-contract`, `loading-states`, `double-submit`, `rbac-matrix`, `route-crawler`) — replace `beforeEach(loginAs)` with `test.use({ storageState: 'e2e/.auth/admin.json' })`.
- **New** `e2e/probes/storage-state-smoke.spec.ts` — behavioural regression test (no /login redirect, no login POST, authed user email visible).
- `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — promote BUG-032 indirect reference to full catalogue row.
- `docs/fix-registry.md` — add `R-FIX-E2E-STORAGE-STATE-LOGIN` row.
- `docs/audit-2026-04-19/bug-plans/BUG-032-login-redirect-storage-state.md` — this plan doc.

**Key shape — globalSetup:**
```ts
import { chromium, type FullConfig } from '@playwright/test';
import { mkdirSync, existsSync } from 'fs';
import { USERS } from './auth';

const AUTH_DIR = 'e2e/.auth';
const USERS_TO_SETUP = ['admin', 'clinician', 'manager'] as const;

export default async function globalSetup(config: FullConfig) {
  const { baseURL } = config.projects[0].use;
  mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const userKey of USERS_TO_SETUP) {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      await page.goto('/login');
      await page.evaluate(() => sessionStorage.setItem('tour-dismissed', 'true'));
      await page.getByLabel(/email/i).fill(USERS[userKey].email);
      await page.locator('input[name="password"]').fill(USERS[userKey].password);
      await page.getByRole('button', { name: /sign in/i }).click();
      await page.waitForURL('**/dashboard', { timeout: 30_000 });
      if (!page.url().endsWith('/dashboard')) {
        const screenshot = `${AUTH_DIR}/${userKey}-setup-failure.png`;
        await page.screenshot({ path: screenshot, fullPage: true });
        throw new Error(
          `globalSetup: ${userKey} landed on ${page.url()} not /dashboard — see ${screenshot}`,
        );
      }
      await context.storageState({ path: `${AUTH_DIR}/${userKey}.json` });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  for (const userKey of USERS_TO_SETUP) {
    if (!existsSync(`${AUTH_DIR}/${userKey}.json`)) {
      throw new Error(`globalSetup: ${userKey}.json not produced — storage state write failed`);
    }
  }
}
```

**Key shape — auth.ts context fixture:**
```ts
export const test = base.extend<{...}>({
  context: async ({ context }, use) => {
    // BUG-032 — storageState does NOT persist sessionStorage per Playwright
    // core types (types.d.ts:9287-9329). Re-apply tour-dismissed on every
    // page in this context so probes don't see the guided-tour overlay.
    await context.addInitScript(() =>
      sessionStorage.setItem('tour-dismissed', 'true'),
    );
    await use(context);
  },
  // ... existing authedPage + consoleCapture fixtures
});
```

**Key shape — probe file migration:**
```ts
// e2e/probes/route-crawler.spec.ts — before
test.beforeEach(async ({ page }) => {
  await loginAs(page, 'admin');
});

// after
test.use({ storageState: 'e2e/.auth/admin.json' });
// beforeEach removed
```

## 7. Tests

**New behavioural regression (`storage-state-smoke.spec.ts`) — 2 tests:**
1. `dashboard loads without visiting /login` — navigate to `/dashboard`, assert URL stays at `/dashboard`, assert no `/login` response, assert authed user email is visible.
2. `no POST /api/v1/auth/login occurs during authenticated navigation` — navigate to `/dashboard`, wait 2s, assert zero `POST /api/v1/auth/login` requests.

**Red-first trace:**
- Pre-fix: `npx playwright test e2e/probes/route-crawler.spec.ts --project=chromium` fails at the 8th test (`/drafts`) — stuck at `/login` with disabled sign-in button (reproduced in diagnostic phase; snapshot captured in test-results).
- Post-fix: full 50-route probe run passes without a single re-login POST.

Unit + integration test suites are unchanged; this is a test-infra fix.

## 8. Verification trace

- **Original failing scenario** — 50 sequential logins → post-fix: 1 login per role per test run in globalSetup; per-test contexts restore via storageState.
- **User-session limit unchanged in production** — `MAX_SESSIONS=5` still enforced in authService; probe suites now respect it (≤3 active sessions per test run total).
- **Auth rate-limiter bucket** — 1 login attempt per role per run (3 total for globalSetup), well within dev (200/15min) and prod (10/15min) caps.
- **MFA / change-password paths** — `01-auth.spec.ts` retained with direct `loginAs`, so those branches are still exercised.
- **Fresh browser context** — storageState cookies + localStorage + IndexedDB restore; sessionStorage reapplied via `addInitScript` on every new page.
- **Existing Phase-I specs using `loginAs`** — unchanged; test files that explicitly test login UI keep their direct login path.
- **globalSetup failure mode** — post-login URL check + screenshot + loud throw; filesystem noise disambiguated from auth failure.

## 9. Residual risk

- **storageState files contain session tokens.** `.gitignore` entry + globalSetup regenerates on every run; leakage risk bounded to developer laptop. Prod CI regenerates per job.
- **Dev-server staff_sessions reset mid-run** — storage state in files becomes invalid; tests fail until next globalSetup. Acceptable: globalSetup is cheap (3 logins) and runs automatically at every `playwright test` invocation.
- **Fixing login unblocks downstream probe failures.** The 49 tests that "did not run" after the 8th hang will now run and may surface new bugs. Any discoveries become new BUG rows.
- **`01-auth.spec.ts` untouched** — intentional. Real login smoke-test coverage preserved.
- **Tour-dismiss flag depends on sessionStorage key name** — if `GuidedTourOverlay` ever changes its key, the addInitScript silently stops working. Acceptable: probe failures would surface immediately if the overlay re-appears.

## 10. CAB / change-control notes

**Catalogue: BUG-032 promoted** from indirect reference in BUG-004 closure note to full YAML row. This is NOT a new bug — the wave plan already lists BUG-032 in PART 2.1 Wave A-1 table; the YAML promotion aligns SSOT with the plan document.

No new dependency. No licence acceptance. No product/schema/API changes.

## 11. QA agent verdicts

### Round 1

- **L1 static:** no new violations introduced (test-infra files are not covered by the L1 file-discovery scope).
- **L2 narrative:** PASS.
- **L3 code judgement:** REQUEST_CHANGES — 3 items:
  1. Band-aid detection: `isAuthenticated: true` enrichment in globalSetup masks a real prod bug (page refresh loses `isAuthenticated`). Fix authStore with `onRehydrateStorage`.
  2. Structural implication: no guard prevents future specs re-adding `beforeEach(loginAs)` pattern.
  3. Test adequacy: smoke tests cover happy path but miss iteration arithmetic — add 10-iteration navigate loop.
- **L4 clinical safety:** N/A — test-infra change, no clinical surface touched.
- **L5 architecture:** REQUEST_CHANGES — 4 items:
  1. Defence-in-depth: same `isAuthenticated` hydration issue as L3 item 1.
  2. SSOT: declaring `storageState` + `authPersona` separately in 8 files is a drift vector — add `useAs(persona)` helper.
  3. Explicit-over-implicit: default `authPersona: 'admin'` is a footgun — flip to `'none'`.
  4. Fail fast: warn to stderr on malformed sidecar JSON (currently silent `catch {}`).
  Plus: file a BUG row for cross-browser probe failures (firefox/webkit/mobile-iphone fail storage-state-smoke test 1).

### Round 2 (after fixes)

All 7 items addressed:

1. **authStore `onRehydrateStorage`** — `apps/web/src/shared/store/authStore.ts:38-48` now derives `isAuthenticated = true` when persisted `user` is present. Fixes the prod page-refresh-loses-auth bug. Removes the need for globalSetup to enrich the sidecar with `isAuthenticated:true`.
2. **`useAs(persona)` helper** — `e2e/fixtures/auth.ts` now exports `useAs(persona)` returning `{ storageState, authPersona }`. All 9 probe specs (8 single-persona + rbac-matrix multi-role) use it. Zero drift surface.
3. **Default persona flipped** — `authPersona: 'none'` in the fixture; every auth-requiring spec must declare via `useAs(...)` or be the unauth case.
4. **Malformed-sidecar warning** — fixture now JSON-parses the sidecar and emits `console.warn` to stderr with the failing path + reason, so a poisoned sidecar doesn't silently redirect to /login.
5. **Guard script** — `.github/scripts/check-no-probe-beforeeach-loginas.sh` scans `e2e/probes/` for `beforeEach(...loginAs(...))` and fails CI on any reintroduction. Wrote the regex to skip comment mentions.
6. **10-iteration navigate loop** — `storage-state-smoke.spec.ts` gained test 4 that navigates 10 protected routes and asserts zero POST `/api/v1/auth/login` fires. Pins the exact pre-fix symptom arithmetic.
7. **BUG-265 filed** — cross-browser probe failures captured as a separate S2 Track B row with `accepted_pattern` enumerating candidate diagnostics.

Round 2 smoke result: **4/4 PASS on chromium** (including the new 10-iteration loop).

Final:
- tsc: clean across 3 workspaces
- fix-registry: 816/816 verified
- guard script: green
- plan doc captures the full deliberation trail
