import { test, expect, loginViaApi, navigateTo } from './fixtures/auth';

/**
 * 10 — Clinical lists & specialized views smoke tests
 *
 * Verifies that every clinical list page loads without crashing
 * and renders its expected landmark content.
 */

// ── helpers ──────────────────────────────────────────────────────────────────

/** Wait for any full-screen spinner / skeleton to disappear. */
async function waitForPageReady(page: import('@playwright/test').Page) {
  await page.locator('[role="progressbar"]').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  await page.locator('text=/loading/i').first().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
}

/**
 * Navigate to a route using client-side routing and assert the page loaded correctly.
 * Checks heading text, verifies no crash / blank screen.
 */
async function navigateAndVerify(
  page: import('@playwright/test').Page,
  path: string,
  headingPattern: RegExp,
) {
  await navigateTo(page, path);
  await waitForPageReady(page);

  // Prefer a semantic heading when present; fall back to matching text.
  const semanticHeading = page.getByRole('heading', { name: headingPattern }).first();
  if (await semanticHeading.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await expect(semanticHeading).toBeVisible({ timeout: 10_000 });
    return;
  }
  await expect(page.getByText(headingPattern).first()).toBeVisible({ timeout: 10_000 });
}

// ── tests ────────────────────────────────────────────────────────────────────

test.describe('Clinical lists & specialized views', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, 'clinician');
  });

  // ── 1. Bed Board (/bed-board) ──────────────────────────────────────────

  test('Bed Board loads with ward layout', async ({ page }) => {
    await navigateTo(page, '/bed-board');
    await waitForPageReady(page);

    await expect(
      page.getByText(/bed|ward|occupied|vacant/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── 2. LAI List (/list/lai) ────────────────────────────────────────────

  test('LAI tracking list loads', async ({ page }) => {
    await navigateAndVerify(page, '/list/lai', /lai|long.acting\s*inject/i);
  });

  // ── 3. MH Act List (/list/mha) ────────────────────────────────────────

  test('Mental Health Act list loads', async ({ page }) => {
    await navigateAndVerify(page, '/list/mha', /mental\s*health\s*act|mha|section/i);
  });

  // ── 4. Clozapine List (/list/clozapine) ───────────────────────────────

  test('Clozapine monitoring list loads', async ({ page }) => {
    await navigateAndVerify(page, '/list/clozapine', /clozapine|cloz/i);
  });

  // ── 5. 91-Day Review (/list/91day) ────────────────────────────────────

  test('91-day review list loads', async ({ page }) => {
    await navigateAndVerify(page, '/list/91day', /91.day|review/i);
  });

  // ── 6. Hot Spots (/list/hotspots) ─────────────────────────────────────

  test('Hot spots list loads', async ({ page }) => {
    await navigateAndVerify(page, '/list/hotspots', /hot\s*spot|incident|alert/i);
  });

  // ── 7. Referral List (/list/referrals) ────────────────────────────────

  test('Referral list loads', async ({ page }) => {
    await navigateAndVerify(page, '/list/referrals', /referral/i);
  });

  // ── 8. Handover (/handover) ───────────────────────────────────────────

  test('Shift handover page loads', async ({ page }) => {
    await navigateAndVerify(page, '/handover', /handover|shift/i);
  });

  // ── 9. Group Therapy (/group-therapy) ─────────────────────────────────

  test('Group Therapy page loads', async ({ page }) => {
    await navigateTo(page, '/group-therapy');
    await waitForPageReady(page);

    await expect(
      page.getByText(/group/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── 10. Nursing (/nursing) ────────────────────────────────────────────

  test('Nursing page loads', async ({ page }) => {
    await navigateAndVerify(page, '/nursing', /nurs/i);
  });

  // ── 11. Psychiatrist (/psychiatrist) ──────────────────────────────────

  test('Psychiatrist dashboard loads', async ({ page }) => {
    await navigateAndVerify(page, '/psychiatrist', /psychiatr/i);
  });

  // ── 12. Case Management (/case-management) ────────────────────────────

  test('Case Management page loads', async ({ page }) => {
    await navigateAndVerify(page, '/case-management', /case\s*manage/i);
  });

  // ── 13. Dashboard (/dashboard) ────────────────────────────────────────

  test('Dashboard loads with widgets and cards', async ({ page }) => {
    await navigateTo(page, '/dashboard');
    await waitForPageReady(page);

    // Dashboard should display summary widgets / cards
    // Look for common dashboard elements: patient count, tasks, appointments
    const widgetLocator = page
      .locator('[class*="Card"], [class*="Widget"], [class*="card"], [class*="widget"]')
      .or(page.locator('[class*="MuiCard"], [class*="MuiPaper"]'));

    const widgetCount = await widgetLocator.count();
    expect(widgetCount).toBeGreaterThan(0);

    // Verify at least one of the expected summary labels is present
    await expect(
      page.getByText(/patient|task|appointment|admission|census|occupancy/i).first(),
    ).toBeVisible();
  });
});
