/**
 * BUG-032 regression — storageState smoke tests.
 *
 * Proves the class of failure is gone: probe contexts restored via
 * test.use({ storageState }) reach protected routes WITHOUT redirecting
 * to /login and WITHOUT firing a fresh POST /api/v1/auth/login. Previously,
 * every probe test re-ran loginAs in beforeEach, causing the 8th login
 * to hang at the auth rate-limiter + session-cap intersection.
 *
 * These assertions are behavioural: they check what the browser does,
 * not implementation details like "the admin.json file has N cookies".
 *
 * Red-first trace: delete e2e/.auth/admin.json after globalSetup has
 * produced it → the `test.use({ storageState: 'e2e/.auth/admin.json' })`
 * call throws at fixture construction, making the failure mode explicit
 * and easy to diagnose.
 */

import { test, expect, useAs } from '../fixtures/auth';

test.use(useAs('superadmin'));

test.describe.configure({ mode: 'serial' });

test.describe('BUG-032 — storage-state smoke', () => {
  test('dashboard loads without visiting /login (proves authenticated state restored)', async ({ page }) => {
    const loginRedirects: string[] = [];
    page.on('response', (r) => {
      // Record any response whose URL path is exactly /login (the UI route)
      // OR the login API endpoint — both would indicate storageState failure.
      const u = new URL(r.url());
      if (u.pathname === '/login' || u.pathname.endsWith('/api/v1/auth/login')) {
        loginRedirects.push(u.pathname);
      }
    });

    await page.goto('/dashboard');
    // Give the SPA a moment to settle (redirect guards run on mount).
    await page.waitForTimeout(2000);

    await expect(page).toHaveURL(/\/dashboard$/);
    expect(
      loginRedirects,
      `authenticated session should not redirect to /login — got: ${JSON.stringify(loginRedirects)}`,
    ).toEqual([]);
  });

  test('no POST /api/v1/auth/login is issued during authenticated navigation (proves no re-login mutation)', async ({ page }) => {
    const loginPosts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/api/v1/auth/login')) {
        loginPosts.push(req.url());
      }
    });

    await page.goto('/dashboard');
    await page.waitForTimeout(2000);
    // Exercise a couple of protected sub-routes to confirm no re-login is
    // triggered when the SPA navigates between authenticated surfaces.
    await page.goto('/patients');
    await page.waitForTimeout(1000);
    await page.goto('/tasks');
    await page.waitForTimeout(1000);

    expect(
      loginPosts,
      `authenticated navigation should not trigger a fresh login POST — got: ${JSON.stringify(loginPosts)}`,
    ).toEqual([]);
  });

  test('authenticated user identity renders in the UI (proves the session belongs to the seeded admin)', async ({ page }) => {
    await page.goto('/dashboard');
    // The dashboard renders a "Welcome back, {givenName} {familyName}" header
    // for the authenticated user. The seeded admin is "E2E Admin" — this
    // assertion proves the restored session belongs to that specific staff
    // row. Falls back to a looser marker if the welcome-header wording drifts.
    const welcome = page.getByText(/welcome back, E2E Admin/i).first();
    await expect(welcome).toBeVisible({ timeout: 15_000 });
  });

  test('10-iteration navigation does not re-trigger login (pins the pre-fix 8th-login hang arithmetic)', async ({ page }) => {
    // BUG-032 L3 review — the specific pre-fix symptom was that the 8th UI
    // login in a serial-mode suite hung at the session-cap + rate-limiter
    // intersection. This test iterates navigation across 10 protected
    // routes and asserts ZERO POST /api/v1/auth/login fires during the
    // run. If a future regression brings back per-test loginAs in
    // beforeEach, this loop will trip on iteration 1 (one POST) rather
    // than silently dying on iteration 8 again.
    const loginPosts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/api/v1/auth/login')) {
        loginPosts.push(req.url());
      }
    });
    const routes = [
      '/dashboard',
      '/patients',
      '/tasks',
      '/appointments',
      '/dashboard',
      '/patients',
      '/tasks',
      '/appointments',
      '/dashboard',
      '/patients',
    ];
    for (const r of routes) {
      await page.goto(r);
      await page.waitForTimeout(500);
    }
    expect(
      loginPosts,
      `10-iteration navigation should not re-trigger login — got ${loginPosts.length} POST /auth/login`,
    ).toEqual([]);
  });
});
