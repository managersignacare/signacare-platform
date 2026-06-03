/**
 * E2E Tests — Correspondence tab (Messages / Threads / Letters)
 *
 * Updated to current UI contract:
 * - filter chips (not inner MUI tabs)
 * - "Send Patient Message" action
 * - unified letters panel
 */
import { test, expect, loginViaApi, navigateToPatient, clickPatientTab, navigateTo, dismissTourPopup } from './fixtures/auth';

const unique = () => Date.now().toString(36);

async function clickFilterChip(page: import('@playwright/test').Page, label: string) {
  const chip = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  await expect(chip).toBeVisible({ timeout: 8_000 });
  await chip.click();
}

async function dismissContactFormIfOpen(page: import('@playwright/test').Page) {
  const closeBtn = page.getByRole('button', { name: /close|cancel|skip/i }).first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
  }
}

async function selectFirstEnabledOption(page: import('@playwright/test').Page) {
  const options = page.getByRole('option');
  const count = await options.count();
  for (let i = 0; i < count; i += 1) {
    const option = options.nth(i);
    const disabled = (await option.getAttribute('aria-disabled')) === 'true';
    const text = ((await option.textContent()) ?? '').trim();
    if (disabled || !text || text.startsWith('—')) continue;
    await option.click();
    return;
  }
  throw new Error('No enabled selectable option found in listbox.');
}

test.describe('Correspondence tab', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, 'clinician');
    await navigateToPatient(page, 'Johnson');
    await dismissTourPopup(page);
    await clickPatientTab(page, 'Correspondence');
    await expect(page.getByText('Correspondence').first()).toBeVisible({ timeout: 10_000 });
  });

  test('correspondence loads with expected filter chips', async ({ page }) => {
    for (const label of ['All Activity', 'Messages', 'Threads', 'Letters']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first()).toBeVisible();
    }
  });

  test('can compose a letter and save it as draft', async ({ page }) => {
    await clickFilterChip(page, 'Letters');
    await expect(page.getByText('Letters').first()).toBeVisible();

    await page.getByRole('button', { name: /Compose Letter/i }).first().click();
    const composeDialog = page.getByRole('dialog', { name: /Compose Letter/i });
    await expect(composeDialog).toBeVisible();

    await composeDialog.getByRole('combobox').first().click();
    await selectFirstEnabledOption(page);

    const letterSubject = `E2E Draft Letter ${unique()}`;
    await composeDialog.getByLabel(/Subject/i).fill(letterSubject);
    await composeDialog.getByLabel(/Letter Body/i).fill('This is an automated E2E draft letter.');
    await composeDialog.getByRole('button', { name: /Save Draft/i }).click();

    await expect(composeDialog).toBeHidden({ timeout: 12_000 });
    await dismissContactFormIfOpen(page);

    const letterCard = page.locator('.MuiCard-root').filter({ hasText: letterSubject }).first();
    await expect(letterCard).toBeVisible({ timeout: 8_000 });
    await expect(letterCard).toContainText(/\bdraft\b/i);
  });

  test('can compose and send a letter', async ({ page }) => {
    await clickFilterChip(page, 'Letters');
    await page.getByRole('button', { name: /Compose Letter/i }).first().click();

    const composeDialog = page.getByRole('dialog', { name: /Compose Letter/i });
    await expect(composeDialog).toBeVisible();

    await composeDialog.getByRole('combobox').first().click();
    await selectFirstEnabledOption(page);

    const letterSubject = `E2E Sent Letter ${unique()}`;
    await composeDialog.getByLabel(/Subject/i).fill(letterSubject);
    await composeDialog.getByLabel(/Letter Body/i).fill('Automated E2E letter — sent.');
    await composeDialog.getByRole('button', { name: /^Send$/i }).click();

    await expect(composeDialog).toBeHidden({ timeout: 12_000 });
    await dismissContactFormIfOpen(page);

    const letterCard = page.locator('.MuiCard-root').filter({ hasText: letterSubject }).first();
    await expect(letterCard).toBeVisible({ timeout: 8_000 });
    await expect(letterCard).toContainText(/\bsent\b/i);
  });

  test('messages panel loads and can save a patient message', async ({ page }) => {
    await clickFilterChip(page, 'Messages');
    await expect(page.getByText('Messages').first()).toBeVisible({ timeout: 8_000 });

    await page.getByRole('button', { name: /Send Patient Message/i }).click();
    const dialog = page.getByRole('dialog', { name: /Send Patient Message/i });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('combobox').first().click();
    await selectFirstEnabledOption(page);
    await page.keyboard.press('Escape');

    const msg = `E2E patient message ${unique()}`;
    await dialog.getByLabel(/Message/i).fill(msg);
    await dialog.getByRole('button', { name: /Save Message/i }).click();

    await expect(dialog).toBeHidden({ timeout: 12_000 });
    await dismissContactFormIfOpen(page);
    await expect(page.getByRole('dialog', { name: /Log Contact \/ Encounter/i })).toBeVisible({ timeout: 8_000 });
    await dismissContactFormIfOpen(page);
  });
});

test.describe('Correspondence standalone page', () => {
  test('the /correspondence route loads without crashing', async ({ page }) => {
    await loginViaApi(page, 'clinician');
    await navigateTo(page, '/correspondence');
    await page.waitForTimeout(1500);
    const content = await page.locator('body').textContent();
    expect((content ?? '').length).toBeGreaterThan(0);
  });
});

test.describe('Notes accessibility from correspondence context', () => {
  test('episodes then correspondence load without error banner', async ({ page }) => {
    await loginViaApi(page, 'clinician');
    await navigateToPatient(page, 'Johnson');

    await clickPatientTab(page, 'Episodes');
    await page.waitForTimeout(1200);
    await expect(page.locator('main').first()).not.toContainText(/Failed to load/i, { timeout: 8_000 });

    await clickPatientTab(page, 'Correspondence');
    await expect(page.getByText('Correspondence').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /^Messages$/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Letters$/i }).first()).toBeVisible();
  });
});
