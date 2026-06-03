/**
 * Phase II.L — Visual regression baseline for top-traffic screens.
 *
 * First run: produces baseline PNGs in e2e/visual/__screenshots__/.
 * Subsequent runs diff. Any diff >100 pixels = regression candidate.
 *
 * Animations disabled + caret hidden to keep pixel-exactness.
 *
 * Run:
 *   # First time (generates baselines)
 *   npx playwright test --project=visual --update-snapshots
 *   # Subsequent (diffs against baseline)
 *   npx playwright test --project=visual
 *
 * Screens captured:
 *   - Login (public)
 *   - Dashboard (post-login)
 *   - Patient list
 *   - Tasks list
 *   - Appointments list
 *   - Calendar
 *   - Reports page
 *   - Handover list
 *   - Drafts page
 *   - Subscription page
 *
 * Screens NOT captured here (need richer seed data):
 *   - Patient detail (requires seeded patient)
 *   - Letter composer (requires seeded letter template + patient)
 *   - Training admin (requires seeded models)
 *   — documented in manual-test-backlog.md for future pass.
 */
import { test, expect, loginAs } from '../fixtures/auth';

test.describe.configure({ mode: 'serial' });

const SCREENSHOT_OPTIONS = {
  // Viewport-only snapshots are more stable than fullPage captures on
  // data-heavy screens where list height changes across seeded datasets.
  fullPage: false,
  animations: 'disabled' as const,
  caret: 'hide' as const,
  maxDiffPixels: 100,
};

test.describe('Visual regression — top-traffic screens', () => {
  test('login page baseline', async ({ page }) => {
    await page.goto('/login');
    await page.waitForTimeout(1000);
    await expect(page).toHaveScreenshot('login.png', SCREENSHOT_OPTIONS);
  });

  test.describe('authenticated screens', () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, 'admin');
    });

    test('dashboard baseline', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForTimeout(2000);
      await expect(page).toHaveScreenshot('dashboard.png', SCREENSHOT_OPTIONS);
    });

    test('patient list baseline', async ({ page }) => {
      await page.goto('/patients');
      await page.waitForTimeout(2000);
      await expect(page).toHaveScreenshot('patients.png', SCREENSHOT_OPTIONS);
    });

    test('tasks list baseline', async ({ page }) => {
      await page.goto('/tasks');
      await page.waitForTimeout(2000);
      await expect(page).toHaveScreenshot('tasks.png', SCREENSHOT_OPTIONS);
    });

    test('appointments list baseline', async ({ page }) => {
      await page.goto('/appointments');
      await page.waitForTimeout(2000);
      await expect(page).toHaveScreenshot('appointments.png', SCREENSHOT_OPTIONS);
    });

    test('calendar baseline', async ({ page }) => {
      await page.goto('/calendar');
      await page.waitForTimeout(2000);
      await expect(page).toHaveScreenshot('calendar.png', SCREENSHOT_OPTIONS);
    });

    test('reports baseline', async ({ page }) => {
      await page.goto('/reports');
      await page.waitForTimeout(2000);
      await expect(page).toHaveScreenshot('reports.png', SCREENSHOT_OPTIONS);
    });

    test('handover baseline', async ({ page }) => {
      await page.goto('/handover');
      await page.waitForTimeout(2000);
      await expect(page).toHaveScreenshot('handover.png', SCREENSHOT_OPTIONS);
    });

    test('drafts baseline', async ({ page }) => {
      await page.goto('/drafts');
      await page.waitForTimeout(2000);
      await expect(page).toHaveScreenshot('drafts.png', SCREENSHOT_OPTIONS);
    });

    test('subscription baseline', async ({ page }) => {
      await page.goto('/subscription');
      await page.waitForTimeout(2000);
      await expect(page).toHaveScreenshot('subscription.png', SCREENSHOT_OPTIONS);
    });
  });
});
