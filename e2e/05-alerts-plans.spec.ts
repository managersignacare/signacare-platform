/**
 * E2E Tests — Alerts & Plans tab
 *
 * Covers: alerts creation, unified plans workflow (management/recovery/safety),
 * recovery-star persistence, and incidents tab availability.
 */
import { test, expect, loginViaApi, navigateToPatient, clickPatientTab, dismissTourPopup } from './fixtures/auth';

async function clickTopTab(page: import('@playwright/test').Page, label: string) {
  const tabBar = page.locator('[role="tablist"][aria-label="Navigation tabs"]').first();
  await expect(tabBar).toBeVisible({ timeout: 8_000 });
  await tabBar.getByRole('tab', { name: label }).click();
}

const unique = () => Date.now().toString(36);

test.describe('Alerts & Plans tab', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, 'clinician');
    await navigateToPatient(page, 'Johnson');
    await dismissTourPopup(page);
    await clickPatientTab(page, 'Alerts & Plans');
  });

  test('top-level tabs are visible after navigating to Alerts & Plans', async ({ page }) => {
    for (const label of ['Alerts', 'Plans', 'Recovery Star', 'Incidents']) {
      await expect(
        page.locator('[role="tablist"]').first().getByRole('tab', { name: label }),
      ).toBeVisible();
    }
  });

  test('can create and view an alert', async ({ page }) => {
    await clickTopTab(page, 'Alerts');
    await page.getByRole('button', { name: /Add Alert/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('.MuiSelect-select').first().click();
    const typeOption = page.locator('[role="listbox"] [role="option"]').first();
    await expect(typeOption).toBeVisible({ timeout: 5_000 });
    await typeOption.click();

    const alertTitle = `E2E Alert ${unique()}`;
    await dialog.locator('input[type="text"]').first().fill(alertTitle);
    await dialog.locator('textarea').first().fill('Automated E2E test alert — safe to delete.');
    await dialog.getByRole('button', { name: /Create Alert/i }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(alertTitle)).toBeVisible({ timeout: 8_000 });
  });

  test('plans tab — create management plan and verify template options are clean', async ({ page }) => {
    await clickTopTab(page, 'Plans');
    await expect(page.getByText('Plans').first()).toBeVisible({ timeout: 8_000 });

    await page.getByRole('button', { name: /Add Plan/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Management Plan/i }).first().click();

    await dialog.getByRole('combobox').nth(1).click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    const options = listbox.getByRole('option');
    const count = await options.count();
    for (let i = 0; i < count; i += 1) {
      const text = (await options.nth(i).textContent()) ?? '';
      expect(text).not.toMatch(/Wellness Recovery Action Plan|WRAP/i);
    }
    await page.keyboard.press('Escape');

    const title = `E2E Management Plan ${unique()}`;
    await dialog.getByLabel(/Plan Title/i).fill(title);
    await dialog.getByLabel(/Plan Content/i).fill('Management plan content from E2E.\nLine 2.');
    await dialog.getByRole('button', { name: /Save Plan/i }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 8_000 });
  });

  test('can create a recovery plan via unified plans dialog', async ({ page }) => {
    await clickTopTab(page, 'Plans');
    await page.getByRole('button', { name: /Add Plan/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Recovery Plan/i }).first().click();

    const recoveryTitle = `E2E Recovery ${unique()}`;
    const planContent = `E2E Recovery Plan ${unique()}\n\nGoals:\n- Stay connected\n- Attend therapy`;
    await dialog.getByLabel(/Plan Title/i).fill(recoveryTitle);
    await dialog.getByLabel(/Plan Content/i).fill(planContent);
    await dialog.getByRole('button', { name: /Save Plan/i }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(recoveryTitle).first()).toBeVisible({ timeout: 8_000 });
  });

  test('safety plan saves and persists after page reload', async ({ page }) => {
    await clickTopTab(page, 'Plans');
    await page.getByRole('button', { name: /Add Plan/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Safety Plan/i }).first().click();
    await expect(dialog.getByText(/Stanley-Brown/i)).toBeVisible();

    await dialog.getByLabel(/Warning Signs/i).fill(`E2E warning sign ${unique()}`);
    await dialog.getByLabel(/Internal Coping Strategies/i).fill('Walk, music');
    await dialog.getByLabel(/People.*Distraction/i).fill('Friend Alice');
    await dialog.getByLabel(/People I Can Ask for Help/i).fill('Mum');
    await dialog.getByLabel(/Professionals.*Agencies/i).fill('Dr Smith');
    await dialog.getByLabel(/Making the Environment Safe/i).fill('Lock cabinet');
    await dialog.getByLabel(/Reasons for Living/i).fill('Family');
    await dialog.getByRole('button', { name: /Save Safety Plan/i }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText('Active Safety Plan')).toBeVisible({ timeout: 8_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await clickPatientTab(page, 'Alerts & Plans');
    await clickTopTab(page, 'Plans');
    await expect(page.getByText('Active Safety Plan')).toBeVisible({ timeout: 10_000 });
  });

  test('recovery star — save scores and verify assessment history', async ({ page }) => {
    await clickTopTab(page, 'Recovery Star');
    await expect(page.getByText(/Average Score/i)).toBeVisible();

    const sliders = page.locator('input[type="range"]');
    await expect(sliders).toHaveCount(10, { timeout: 5_000 });
    await sliders.nth(0).fill('8');
    await sliders.nth(9).fill('9');

    await page.getByRole('button', { name: /Save Recovery Star/i }).click();
    await expect(page.getByRole('button', { name: /Save Recovery Star/i })).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByText(/Previous Assessments/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('button', { name: /Toggle Recovery Star/i }).first()).toBeVisible();
  });

  test('incidents tab renders and allows incident creation entry point', async ({ page }) => {
    await clickTopTab(page, 'Incidents');
    await expect(page.getByText('Incidents').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('button', { name: /Add Incident/i })).toBeVisible();
  });
});
