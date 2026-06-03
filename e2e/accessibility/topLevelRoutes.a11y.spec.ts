/**
 * WCAG 2.1 AA accessibility audit — top-level clinical routes.
 *
 * GAP-01 expansion — extends axe-core coverage beyond /login, /patients,
 * and the patient-detail tabs into the remaining high-traffic surfaces:
 *   - /dashboard  (role-specific KPIs)
 *   - /handover   (shift handover with AI summary)
 *   - /reports    (admin reports + Report Builder)
 *
 * These are the screens a clinician / manager lands on outside the chart.
 * An a11y regression on any of them excludes assistive-tech users from the
 * daily workflow.
 *
 * Skips routes that are disabled by clinic_tab_config so tests survive the
 * per-clinic module toggles.
 *
 * Standard: WCAG 2.1 AA, IEC 62366-1, DDA 1992, NSQHS Std 2.
 */

import { test } from '../fixtures/auth';
import AxeBuilder from '@axe-core/playwright';
import { LoginPage } from '../pages';
import { assertCriticalSeriousWithinBaseline } from './lib/axeBaseline';

async function runAxe(page: import('@playwright/test').Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('iframe')
    .analyze();
  assertCriticalSeriousWithinBaseline(label, results);
}

test.describe('Accessibility — top-level routes', () => {
  test.beforeEach(async ({ page }) => {
    await new LoginPage(page).loginAs('clinician');
  });

  test('/dashboard has zero critical/serious axe violations', async ({ page }) => {
    await page.goto('/dashboard');
    // The dashboard lazy-loads role-specific widgets — wait for any KPI
    // card to render before scanning so we audit the real DOM not a skeleton.
    await page.waitForSelector('[role="main"]', { timeout: 10_000 });
    await page.waitForTimeout(750);
    await runAxe(page, '/dashboard');
  });

  test('/handover has zero critical/serious axe violations', async ({ page }) => {
    await page.goto('/handover');
    // Handover is gated behind clinic_tab_config — skip gracefully if the
    // clinic we logged in as does not have it enabled.
    if (page.url().includes('/dashboard') || page.url().includes('/404')) {
      test.skip(true, 'Handover module not enabled for this clinic');
      return;
    }
    await page.waitForSelector('[role="main"]', { timeout: 10_000 });
    await page.waitForTimeout(750);
    await runAxe(page, '/handover');
  });

  test('/reports has zero critical/serious axe violations', async ({ page }) => {
    await page.goto('/reports');
    if (page.url().includes('/dashboard') || page.url().includes('/404')) {
      test.skip(true, 'Reports module not enabled for this clinic');
      return;
    }
    await page.waitForSelector('[role="main"]', { timeout: 10_000 });
    await page.waitForTimeout(750);
    await runAxe(page, '/reports');
  });
});
