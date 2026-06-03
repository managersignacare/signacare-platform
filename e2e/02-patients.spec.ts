import { test, expect, loginViaApi, navigateViaSidebar, navigateTo, dismissTourPopup } from './fixtures/auth';
import type { Locator } from '@playwright/test';

// Unique suffix to avoid collisions across test runs
const RUN_ID = Date.now().toString(36).slice(-5);
const TEST_FAMILY_NAME = `TestPatient${RUN_ID}`;
const TEST_GIVEN_NAME = 'E2E';
const TEST_DOB = '2000-01-15';

async function advanceWizardToFinalAction(
  dialog: Locator,
  finalActionLabel: RegExp,
  maxNextClicks = 12,
): Promise<void> {
  for (let clickCount = 0; clickCount < maxNextClicks; clickCount += 1) {
    const finalActionButton = dialog.getByRole('button', { name: finalActionLabel });
    if (await finalActionButton.isVisible().catch(() => false)) {
      await expect(finalActionButton).toBeEnabled({ timeout: 10_000 });
      return;
    }

    const nextButton = dialog.getByRole('button', { name: /^next$/i });
    await expect(nextButton).toBeVisible({ timeout: 10_000 });
    await expect(nextButton).toBeEnabled({ timeout: 10_000 });
    await nextButton.click();
  }

  throw new Error(
    `Wizard did not reach final action ${finalActionLabel.toString()} after ${maxNextClicks} Next clicks`,
  );
}

test.describe.serial('Patient Management', () => {
  /** Shared patient ID captured after registration */
  let createdPatientId: string;

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Patient list loads with expected table headers
  // ──────────────────────────────────────────────────────────────────────────
  test('patient list page displays table with correct headers', async ({ page }) => {
    await loginViaApi(page, 'admin');
    await navigateViaSidebar(page, 'Patients');

    // Wait for the patients heading and table to load
    await expect(page.getByText('Patients').first()).toBeVisible({ timeout: 15_000 });

    // Wait for table or loading to finish
    await page.waitForTimeout(2000);

    // Verify expected column headers in the MUI table
    const expectedHeaders = ['Family Name', 'Given Name', 'UR Number', 'DOB', 'Status'];
    for (const header of expectedHeaders) {
      await expect(page.getByText(header).first()).toBeVisible();
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Search for a patient filters results
  // ──────────────────────────────────────────────────────────────────────────
  test('search bar filters patient list', async ({ page }) => {
    await loginViaApi(page, 'admin');
    await navigateViaSidebar(page, 'Patients');

    const searchInput = page.getByPlaceholder(/search by name/i);
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // First clear any default clinician filter by switching status to "all"
    // Type a search term that is unlikely to match many patients
    await searchInput.fill('zzz_nonexistent_query');

    // Wait for debounce (350ms) + network
    await page.waitForTimeout(800);

    // Should show "No patients found" or an empty table body
    const noResults = page.getByText(/no patients found/i);
    await expect(noResults).toBeVisible({ timeout: 10_000 });

    // Clear search and verify patients reappear
    await searchInput.clear();
    await page.waitForTimeout(800);

    // Table should have at least one row (the seed data has patients)
    const tableBody = page.locator('table tbody');
    await expect(tableBody.locator('tr').first()).toBeVisible({ timeout: 10_000 });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Register a new patient via the full wizard
  // ──────────────────────────────────────────────────────────────────────────
  test('register a new patient through the wizard', async ({ page }) => {
    await loginViaApi(page, 'admin');
    await navigateViaSidebar(page, 'Patients');

    // Click "Register Patient" button
    const registerBtn = page.getByRole('button', { name: /register patient/i });
    await expect(registerBtn).toBeVisible({ timeout: 10_000 });
    await registerBtn.click();

    // Dialog should open
    const registrationDialog = page.getByRole('dialog').filter({
      hasText: /register new patient/i,
    });
    await expect(registrationDialog).toBeVisible({ timeout: 5_000 });
    await expect(registrationDialog).toContainText(/register new patient/i);

    // ── Step 1: Demographics ──
    await registrationDialog.getByLabel(/given name/i).fill(TEST_GIVEN_NAME);
    await registrationDialog.getByLabel(/family name/i).first().fill(TEST_FAMILY_NAME);
    // DOB input is type="date" — fill with YYYY-MM-DD format for native date input
    const dobInput = registrationDialog.locator('input[type="date"]').first();
    await expect(dobInput).toBeVisible({ timeout: 5_000 });
    await dobInput.fill(TEST_DOB);

    // Click Next to go to Step 2 (Identifiers)
    await registrationDialog.getByRole('button', { name: /next/i }).click();

    // The duplicate-patient guard can intentionally intercept after Step 1.
    // If it appears, continue the wizard as "create new patient" and proceed.
    const duplicateDialog = page.getByRole('dialog').filter({
      hasText: /possible duplicate patients/i,
    });
    let duplicateIntercepted = false;
    await duplicateDialog
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => {
        duplicateIntercepted = true;
      })
      .catch(() => {
        duplicateIntercepted = false;
      });
    if (duplicateIntercepted) {
      await duplicateDialog
        .getByRole('button', { name: /continue/i })
        .click();
      await expect(duplicateDialog).toBeHidden({ timeout: 5_000 });
    }
    await expect(registrationDialog.getByText(/identifiers/i).first()).toBeVisible({
      timeout: 5_000,
    });

    // Move through the wizard by action-state (Next -> Register Patient)
    // instead of brittle step-label text assertions.
    await advanceWizardToFinalAction(registrationDialog, /register patient/i);

    // Check the required consent checkbox: "Patient consents to assessment and treatment"
    const consentCheckbox = registrationDialog.getByRole('checkbox', {
      name: /consents to assessment and treatment/i,
    });
    // If it's not already checked, check it
    if (!(await consentCheckbox.isChecked())) {
      await consentCheckbox.check();
    }

    // Click "Register Patient" (the final step button)
    const submitBtn = registrationDialog.getByRole('button', { name: /register patient/i });
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    // Should navigate to the new patient's detail page
    await page.waitForURL('**/patients/*', { timeout: 15_000 });
    const url = page.url();
    const match = url.match(/\/patients\/([a-f0-9-]+)/);
    expect(match).toBeTruthy();
    createdPatientId = match![1];

    // Dismiss guided tour if visible on patient detail page
    await dismissTourPopup(page);

    // Verify the patient header shows the name: "TestPatientXXXXX, E2E"
    const header = page.locator('header');
    await expect(header.getByText(TEST_FAMILY_NAME)).toBeVisible({ timeout: 10_000 });
    await expect(header.getByText(TEST_GIVEN_NAME)).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Edit patient — change preferred name
  // ──────────────────────────────────────────────────────────────────────────
  test('edit patient preferred name via edit wizard', async ({ page }) => {
    test.skip(!createdPatientId, 'Skipped because patient was not created');

    await loginViaApi(page, 'admin');
    await navigateTo(page, `/patients/${createdPatientId}`);

    // Dismiss guided tour if visible
    await dismissTourPopup(page);

    // Wait for patient detail header to load
    const header = page.locator('header');
    await expect(header.getByText(TEST_FAMILY_NAME)).toBeVisible({ timeout: 15_000 });

    // Navigate to Overview where the Edit button lives.
    // UI has both patterns across versions:
    //   1) top tab bar (role=tab)
    //   2) left-side navigation item ("Overview")
    const overviewTab = page.getByRole('tab', { name: /overview/i });
    if (await overviewTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await overviewTab.click();
    } else {
      const overviewNavItem = page.getByText(/^Overview$/).first();
      await expect(overviewNavItem).toBeVisible({ timeout: 10_000 });
      await overviewNavItem.click();
    }

    // Click "Edit Patient Details" button
    const editBtn = page.getByRole('button', { name: /edit patient details/i });
    await expect(editBtn).toBeVisible({ timeout: 10_000 });
    await editBtn.click();

    // Edit wizard dialog opens
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Change the preferred name field
    const preferredNameInput = dialog.getByLabel(/preferred name/i);
    await expect(preferredNameInput).toBeVisible({ timeout: 5_000 });
    await preferredNameInput.clear();
    await preferredNameInput.fill('Tester');

    // Move through the wizard by action-state (Next -> Save Changes).
    await advanceWizardToFinalAction(dialog, /save changes/i);

    // On the last step, click Save Changes.
    const saveBtn = dialog.getByRole('button', { name: /save changes/i });
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });
    await saveBtn.click();

    // Dialog should close
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Verify the preferred name persists in the Overview demographics card.
    const demographicsCard = page.locator('section, div').filter({
      has: page.getByText(/^Demographics$/i),
    });
    await expect(demographicsCard.getByText(/^Tester$/)).toBeVisible({ timeout: 10_000 });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Patient search on the list page
  // ──────────────────────────────────────────────────────────────────────────
  test('search for the newly created patient by family name', async ({ page }) => {
    test.skip(!createdPatientId, 'Skipped because patient was not created');

    await loginViaApi(page, 'admin');
    await navigateViaSidebar(page, 'Patients');

    const searchInput = page.getByPlaceholder(/search by name/i);
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    await searchInput.fill(TEST_FAMILY_NAME);

    // Wait for debounce + API response
    await page.waitForTimeout(800);

    // The table should contain a row with our test patient's family name
    const table = page.locator('table');
    await expect(table.getByText(TEST_FAMILY_NAME).first()).toBeVisible({ timeout: 10_000 });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Pagination component is present
  // ──────────────────────────────────────────────────────────────────────────
  test('pagination component is visible and shows count', async ({ page }) => {
    await loginViaApi(page, 'admin');
    await navigateViaSidebar(page, 'Patients');

    // Wait for table to load
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15_000 });

    // TablePagination renders a <p> with text like "1-20 of 42"
    // It also contains role="combobox" for rows-per-page selector
    const pagination = page.locator('.MuiTablePagination-root');
    await expect(pagination).toBeVisible({ timeout: 10_000 });

    // Verify it displays a count (e.g. "1-20 of XX")
    await expect(pagination).toContainText(/of \d+/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. View patient detail — click a row, verify tabs load
  // ──────────────────────────────────────────────────────────────────────────
  test('clicking a patient row navigates to detail page with tabs', async ({ page }) => {
    await loginViaApi(page, 'admin');
    await navigateViaSidebar(page, 'Patients');

    // Wait for the table to load with at least one patient row
    const tableBody = page.locator('table tbody');
    const firstRow = tableBody.locator('tr').first();
    await expect(firstRow).toBeVisible({ timeout: 15_000 });

    // Click the first cell (Family Name) which is the clickable link
    await firstRow.locator('td').first().click();

    // Should navigate to /patients/<uuid>
    await page.waitForURL('**/patients/*', { timeout: 10_000 });
    expect(page.url()).toMatch(/\/patients\/[a-f0-9-]+/);

    // Dismiss guided tour if visible
    await dismissTourPopup(page);

    const hasTopTabPattern = await page
      .getByRole('tab', { name: /summary/i })
      .isVisible({ timeout: 2_000 })
      .catch(() => false);

    if (hasTopTabPattern) {
      const expectedTabs = ['Summary', 'Overview', 'Episodes', 'Alerts & Plans', 'Medications'];
      for (const tabName of expectedTabs) {
        const tab = page.getByRole('tab', { name: tabName });
        await expect(tab).toBeVisible({ timeout: 10_000 });
      }

      // Summary tab should be active by default in top-tab layouts.
      const summaryTab = page.getByRole('tab', { name: 'Summary' });
      await expect(summaryTab).toHaveAttribute('aria-selected', 'true');
    } else {
      const expectedNavSections = [
        /^Summary$/i,
        /^Overview$/i,
        /^Episodes$/i,
        /^Alerts\s*&\s*Plans$/i,
        /^(Medications|Active Medications)$/i,
      ];
      for (const sectionPattern of expectedNavSections) {
        await expect(page.getByText(sectionPattern).first()).toBeVisible({ timeout: 10_000 });
      }
    }
  });
});
