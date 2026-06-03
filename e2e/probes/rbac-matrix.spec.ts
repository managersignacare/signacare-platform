/**
 * Probe II.E (T2.9) — RBAC matrix
 *
 * For each seeded role, attempts to access each ADMIN_ROUTES path.
 * Expected: role-route matrix defined in this file (least-privilege by route).
 *
 * Each cell in the matrix: (role × route) → expected `allowed|denied`.
 * Any cell that violates the expectation = RBAC bug.
 *
 * Scope: 5 roles + 5 admin routes = 25 cells.
 *
 * Run: `npx playwright test e2e/probes/rbac-matrix.spec.ts`
 */
import { test, expect, useAs } from '../fixtures/auth';
import { ADMIN_ROUTES } from '../fixtures/routes';

// BUG-032 — each role's authenticated storageState is restored per
// describe block below, so rbac-matrix no longer re-runs loginAs 20 times
// per suite (4 roles × 5 routes). globalSetup produced one auth file per
// role; test.use({ storageState }) swaps them in.
test.describe.configure({ mode: 'serial' });

type RoleKey = 'superadmin' | 'admin' | 'manager' | 'receptionist' | 'clinician';

const ROLES: RoleKey[] = ['superadmin', 'admin', 'manager', 'receptionist', 'clinician'];

// Subset of admin routes to probe — full list would be 11 routes × 4 roles
// = 44 specs. Keep the matrix tight: the 5 highest-sensitivity admin
// routes.
const PROBE_ROUTES = ADMIN_ROUTES.filter((r) =>
  ['/power-settings', '/org-settings', '/audit', '/manager-dashboard', '/reports'].includes(r.path),
);

const ROUTE_ALLOWED_HEADING: Record<string, RegExp> = {
  '/power-settings': /power settings/i,
  '/org-settings': /org settings/i,
  '/audit': /audit log/i,
  '/manager-dashboard': /manager dashboard/i,
  '/reports': /admin reports|reports/i,
};

const ROLE_ROUTE_EXPECTATION: Record<RoleKey, Partial<Record<string, boolean>>> = {
  superadmin: {
    '/power-settings': true,
    '/org-settings': true,
    '/audit': true,
    '/manager-dashboard': true,
    '/reports': true,
  },
  // clinic admin
  admin: {
    '/power-settings': false,
    '/org-settings': true,
    '/audit': true,
    '/manager-dashboard': true,
    '/reports': true,
  },
  manager: {
    '/power-settings': false,
    '/org-settings': false,
    '/audit': false,
    '/manager-dashboard': false,
    '/reports': true,
  },
  receptionist: {
    '/power-settings': false,
    '/org-settings': false,
    '/audit': false,
    '/manager-dashboard': false,
    '/reports': false,
  },
  clinician: {
    '/power-settings': false,
    '/org-settings': false,
    '/audit': false,
    '/manager-dashboard': false,
    '/reports': false,
  },
};

test.describe('Probe: rbac-matrix', () => {
  for (const role of ROLES) {
    test.describe(`role ${role}`, () => {
      // Restore this role's storageState + hydrate its sessionStorage for
      // all tests under this describe.
      test.use(useAs(role));

      for (const route of PROBE_ROUTES) {
        test(`${role} → ${route.path}`, async ({ page }) => {
          await page.goto(route.path, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(1200);

          const body = await page.locator('body').innerText();
          const url = page.url();
          const currentPath = new URL(url).pathname;
          const redirectedToGuardRoute =
            (currentPath === '/dashboard' || currentPath === '/login') &&
            currentPath !== route.path;
          const allowedHeading = ROUTE_ALLOWED_HEADING[route.path];
          const hasAllowedHeading = allowedHeading
            ? await page.getByRole('heading', { name: allowedHeading }).first().isVisible().catch(() => false)
            : false;
          // Denied signatures intentionally avoid matching audit-log row
          // values like "forbidden_access" (which is data, not a route denial).
          const hasDeniedPhrase =
            /access denied|read access denied|not authorized|you do not have permission|permission required|\bforbidden\b/i.test(body);
          const reportsStillLoading =
            route.path === '/reports'
            && (await page.getByRole('progressbar', { name: /loading/i }).isVisible({ timeout: 1_500 }).catch(() => false));
          const denied =
            redirectedToGuardRoute ||
            (!hasAllowedHeading && hasDeniedPhrase) ||
            reportsStillLoading;

          const expectedAllowed = ROLE_ROUTE_EXPECTATION[role][route.path] ?? false;
          if (expectedAllowed) {
            // Expected: NOT denied + page renders content
            expect(
              denied,
              `${role} should be allowed on ${route.path} but was denied`,
            ).toBe(false);
          } else {
            // Expected: denied (redirected or 403 text)
            expect(
              denied,
              `${role} should be denied on ${route.path} but got through — RBAC gap`,
            ).toBe(true);
          }
        });
      }
    });
  }
});
