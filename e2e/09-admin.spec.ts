import { test, expect, loginViaApi, navigateTo } from './fixtures/auth';

/**
 * 09 — Administrative pages smoke tests
 *
 * Uses navigateTo (client-side pushState) since admin pages
 * are inside collapsible sidebar groups.
 */

async function waitForPageReady(page: import('@playwright/test').Page) {
  await page.locator('[role="progressbar"]').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

test.describe('Admin pages', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, 'admin');
  });

  test('Settings page loads', async ({ page }) => {
    await navigateTo(page, '/settings');
    await waitForPageReady(page);
    await expect(page.getByText(/settings/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Org Settings page loads', async ({ page }) => {
    await navigateTo(page, '/org-settings');
    await waitForPageReady(page);
    await expect(page.getByText(/organi|unit|team/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Staff Assignments page loads', async ({ page }) => {
    await navigateTo(page, '/staff-assignments');
    await waitForPageReady(page);
    await expect(page.getByText(/staff|assign/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Templates page loads', async ({ page }) => {
    await navigateTo(page, '/templates');
    await waitForPageReady(page);
    await expect(page.getByText(/template/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Billing page loads', async ({ page }) => {
    await navigateTo(page, '/billing');
    await waitForPageReady(page);
    await expect(page.getByText(/billing|invoice|financial/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Audit Log page loads', async ({ page }) => {
    await navigateTo(page, '/audit');
    await waitForPageReady(page);
    await expect(page.getByText(/audit/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Reports page loads', async ({ page }) => {
    await navigateTo(page, '/reports');
    await waitForPageReady(page);
    await expect(page.getByText(/report/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Exports page loads', async ({ page }) => {
    await navigateTo(page, '/exports');
    await waitForPageReady(page);
    await expect(page.getByText(/export/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Power Settings page loads for admin user', async ({ page }) => {
    await navigateTo(page, '/power-settings');
    await waitForPageReady(page);
    await expect(page.getByText(/power|platform|system/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
