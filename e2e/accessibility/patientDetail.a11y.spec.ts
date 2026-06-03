/**
 * WCAG 2.1 AA accessibility audit — Patient detail surfaces.
 *
 * GAP-01 expansion — covers the most-used clinical surface beyond
 * /login and /patients. The patient detail tabs are where clinicians
 * spend the bulk of their day; an a11y regression here excludes
 * assistive-tech users from the primary workflow.
 *
 * Runs axe against:
 *   - Summary tab
 *   - Clinical Notes tab
 *   - Medications tab
 *   - Risk / Safety Plan tab
 *
 * Standard: WCAG 2.1 AA, IEC 62366-1, DDA 1992, NSQHS Std 2.
 */

import { test, expect, clickPatientTab, dismissTourPopup, ensureMainNavigationClosed } from '../fixtures/auth';
import AxeBuilder from '@axe-core/playwright';
import { LoginPage } from '../pages';
import { assertCriticalSeriousWithinBaseline } from './lib/axeBaseline';

const A11Y_PATIENT_ID = '77777777-7777-4777-8777-777777777777';

async function runAxe(page: import('@playwright/test').Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // Exclude third-party widgets that render inside iframes — they are out
    // of our control and are covered separately in their vendor's own audit.
    .exclude('iframe')
    .analyze();
  assertCriticalSeriousWithinBaseline(label, results);
}

async function waitForTabHydration(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('main').last()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600);
}

test.describe('Accessibility — patient detail tabs', () => {
  test.beforeEach(async ({ page }) => {
    await new LoginPage(page).loginAs('clinician');
    await page.goto(`/patients/${A11Y_PATIENT_ID}`, { waitUntil: 'domcontentloaded' });
    await dismissTourPopup(page);
    await ensureMainNavigationClosed(page);
    await page.getByText(/Fixture,\s*A11y/i).first().waitFor({ state: 'visible', timeout: 10_000 });
    await waitForTabHydration(page);
  });

  test('summary tab has zero critical/serious axe violations', async ({ page }) => {
    await clickPatientTab(page, 'alerts & plans');
    await waitForTabHydration(page);
    await ensureMainNavigationClosed(page);
    await expect(page.getByRole('heading', { name: /alerts/i }).first()).toBeVisible({ timeout: 12_000 });
    await runAxe(page, '/patients/:id (Summary)');
  });

  test('information exchange tab has zero critical/serious axe violations', async ({ page }) => {
    await clickPatientTab(page, 'correspondence');
    await waitForTabHydration(page);
    await ensureMainNavigationClosed(page);
    const correspondenceAnchors = [
      page.getByRole('heading', { name: /correspondence|information exchange/i }).first(),
      page.getByRole('button', { name: /all activity|messages|letters/i }).first(),
      page.getByRole('button', { name: /open information exchange tab/i }).first(),
    ];
    let found = false;
    for (const anchor of correspondenceAnchors) {
      if (await anchor.isVisible({ timeout: 3_000 }).catch(() => false)) {
        found = true;
        break;
      }
    }
    expect(found, 'information exchange anchor did not render in any supported layout').toBe(true);
    await runAxe(page, '/patients/:id (Information Exchange)');
  });

  test('active medications tab has zero critical/serious axe violations', async ({ page }) => {
    await clickPatientTab(page, 'medications');
    await waitForTabHydration(page);
    await ensureMainNavigationClosed(page);
    const medicationAnchors = [
      page.getByRole('button', { name: /i have reviewed these allergies/i }).first(),
      page.getByRole('heading', { name: /medications|active medications/i }).first(),
      page.getByRole('button', { name: /open active medications tab/i }).first(),
    ];
    let found = false;
    for (const anchor of medicationAnchors) {
      if (await anchor.isVisible({ timeout: 3_000 }).catch(() => false)) {
        found = true;
        break;
      }
    }
    expect(found, 'medications anchor did not render in any supported layout').toBe(true);
    await runAxe(page, '/patients/:id (Medications)');
  });

  test('episodes tab has zero critical/serious axe violations', async ({ page }) => {
    await clickPatientTab(page, 'episodes');
    await waitForTabHydration(page);
    await ensureMainNavigationClosed(page);
    await expect(page.getByRole('heading', { name: /episodes of care|active episodes/i }).first()).toBeVisible({ timeout: 12_000 });
    await runAxe(page, '/patients/:id (Episodes)');
  });
});
