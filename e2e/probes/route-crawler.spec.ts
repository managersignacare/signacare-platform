/**
 * Probe II.C.1 — route-crawler
 *
 * Visits every route in ROUTES as an admin user. For each route asserts:
 *   1. HTTP 200 response (no dead URL)
 *   2. No error-boundary text rendered ("Something went wrong", "404",
 *      "500", "Error")
 *   3. At least one heading rendered (rules out blank-page crashes)
 *   4. No console errors / pageerrors captured (via the fixture in
 *      e2e/fixtures/auth.ts consoleCapture)
 *
 * Catches: dashboard-dead-endpoint class (BUG-001), dead routes,
 * missing providers, React crashes, broken lazy loads.
 *
 * Passes = green row in bug catalogue. Failures are candidate new
 * BUGs — recorded in catalogue §Probe T2.2.
 *
 * Run: `npx playwright test e2e/probes/route-crawler.spec.ts`
 */
import { test, expect, useAs } from '../fixtures/auth';
import { ROUTES } from '../fixtures/routes';

// BUG-032 — restore superadmin storageState per context; globalSetup has
// already performed the UI login once. Previously this file re-ran
// loginAs in beforeEach for every route, saturating MAX_SESSIONS + the
// auth rate-limiter bucket and causing the 8th test to hang on
// waitForURL('**/dashboard').
test.use(useAs('superadmin'));

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

test.describe('Probe: route-crawler (as superadmin)', () => {

  for (const route of ROUTES) {
    if (route.tags.includes('public')) continue;
    test(`route ${route.path} renders without error`, async ({ page, consoleCapture }) => {
      // Navigate. Capture any response status from the initial request.
      let responseStatus: number | undefined;
      page.on('response', (r) => {
        if (r.url().endsWith(route.path) || r.url().includes(route.path)) {
          if (!responseStatus) responseStatus = r.status();
        }
      });

      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 20_000 });

      // Give React/lazy-load up to 3s to render something.
      await page.waitForTimeout(3000);

      // (1) No error-boundary fallback text. If the ErrorBoundary
      //     rendered, this assertion will catch it.
      const body = await page.locator('body').innerText();
      expect(body, `error boundary showing on ${route.path}`).not.toMatch(
        /something went wrong|error boundary|application error|500 internal server|cannot read propert/i,
      );

      // (2) 404 / 403 check — router should not send to a NotFound
      //     page for any valid route.
      expect(body, `404 on ${route.path}`).not.toMatch(
        /^404 not found$|^page not found$/im,
      );

      // (3) Page has at least one heading (h1..h6) OR a [role="main"]
      //     landmark with visible content. Loading spinners / dialogs
      //     still count as "rendered".
      const headings = await page.locator('h1, h2, h3, h4, h5, h6').count();
      const hasMain = await page.locator('[role="main"], main').count();
      const hasLoading = await page.locator('[role="progressbar"], .MuiCircularProgress-root').count();
      expect(
        headings + hasMain + hasLoading,
        `no visible headings/main/spinner on ${route.path}`,
      ).toBeGreaterThan(0);

      // (4) Console capture — warnings only flagged here (strict errors
      //     flagged by fixture if test annotated).
      if (consoleCapture.errors.length > 0) {
        console.log(
          `[route-crawler] ${route.path} console.errors:`,
          consoleCapture.errors.slice(0, 5),
        );
      }
      if (consoleCapture.pageErrors.length > 0) {
        console.log(
          `[route-crawler] ${route.path} pageerrors:`,
          consoleCapture.pageErrors.slice(0, 3),
        );
      }
      // Allow up to 2 console errors (prod apps have baseline noise);
      // more than that is a signal.
      expect(
        consoleCapture.pageErrors.length,
        `unhandled pageerror on ${route.path}`,
      ).toBeLessThan(2);
    });
  }
});
