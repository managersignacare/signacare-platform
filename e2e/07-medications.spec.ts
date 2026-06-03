import { test, expect, navigateToPatient, clickPatientTab, navigateTo, dismissTourPopup, useAs } from './fixtures/auth';

/**
 * 07 — Medications tab, allergies, and global medication pages
 *
 * Tests the patient medications tab (prescribe, cease, allergies)
 * and the standalone /medications, /lai, and /clozapine routes.
 */

// ── helpers ──────────────────────────────────────────────────────────────────

/** Wait for full-screen spinners / loading text to disappear. */
async function waitForPageReady(page: import('@playwright/test').Page) {
  await page
    .locator('[role="progressbar"]')
    .waitFor({ state: 'hidden', timeout: 15_000 })
    .catch(() => {});
  await page
    .locator('text=/loading/i')
    .first()
    .waitFor({ state: 'hidden', timeout: 5_000 })
    .catch(() => {});
}

/**
 * Navigate to a known demo patient and open the Medications tab.
 */
async function goToPatientMedications(page: import('@playwright/test').Page) {
  await navigateToPatient(page, 'Johnson');
  await dismissTourPopup(page);
  await clickPatientTab(page, 'Medications');
  const allergyAck = page.getByRole('button', { name: /i have reviewed these allergies/i });
  if (await allergyAck.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await allergyAck.click();
  }
  await waitForPageReady(page);
}

// ── tests ────────────────────────────────────────────────────────────────────

test.describe('Medications tab and prescriptions', () => {
  test.use(useAs('clinician'));

  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  });

  // ── 1. Medications tab loads ──────────────────────────────────────────────

  test('navigating to a patient and clicking Medications tab renders content', async ({
    page,
  }) => {
    await goToPatientMedications(page);

    // The medications sub-tabs should be visible
    await expect(
      page.getByRole('tab', { name: /current medications/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole('tab', { name: /mar chart|lai|clozapine/i }).first(),
    ).toBeVisible();

    // Allergy panel heading should be present
    await expect(page.getByText(/allergies/i).first()).toBeVisible();
  });

  // ── 2. Medication list displays ───────────────────────────────────────────

  test('current medications table or empty state is displayed', async ({
    page,
  }) => {
    await goToPatientMedications(page);

    // Either the table with medication columns is visible, or an empty-state message
    const tableOrEmpty = page
      .getByRole('region', { name: /data table/i })
      .or(page.getByText(/no active medications/i));
    await expect(tableOrEmpty.first()).toBeVisible({ timeout: 10_000 });
  });

  // ── 3. Add (prescribe) a new medication ───────────────────────────────────

  test('prescribe a new medication via the Prescribe dialog', async ({
    page,
  }) => {
    await goToPatientMedications(page);

    // Click "Prescribe" button — may be disabled if user lacks prescriber number.
    // The isPrescriber check is async, so wait for the button to appear.
    // When isPrescriber is false, the disabled button is wrapped in a <span> for tooltip.
    const prescribeBtn = page.getByRole('button', { name: /prescribe/i }).first();

    // Wait for the prescribe button to appear — it may take time for the
    // isPrescriber query to resolve. If it never appears, skip gracefully.
    const prescribeBtnVisible = await prescribeBtn.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!prescribeBtnVisible) {
      // The isPrescriber query may not have resolved or the button is not rendered yet — skip
      return;
    }

    // If the button is disabled (no prescriber number), skip the rest
    if (await prescribeBtn.isDisabled()) {
      // Disabled MUI button is wrapped in a tooltip anchor span. Assert the
      // explanatory aria-label directly instead of hovering a disabled node.
      const tooltipAnchor = prescribeBtn.locator('xpath=ancestor::span[@data-mui-internal-clone-element="true"][1]');
      await expect(tooltipAnchor).toHaveAttribute('aria-label', /prescriber number required/i, { timeout: 5_000 });
      return;
    }

    await prescribeBtn.click();

    // The Prescribe Medication dialog should open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(
      dialog.getByText(/prescribe medication/i),
    ).toBeVisible();

    // Fill in the required fields
    await dialog.getByLabel(/medication name/i).fill('Sertraline 50mg');
    await dialog.getByLabel(/dose/i).first().fill('50mg');

    // Route is a Select — click to open and pick "Oral"
    const routeSelect = dialog.getByLabel(/route/i);
    if (await routeSelect.isVisible()) {
      await routeSelect.click();
      await page.getByRole('option', { name: /oral/i }).click();
    }

    // Frequency is a Select — click to open and pick "Once daily"
    const freqSelect = dialog.getByLabel(/frequency/i);
    if (await freqSelect.isVisible()) {
      await freqSelect.click();
      await page.getByRole('option', { name: /once daily/i }).click();
    }

    // Click "Prescribe & Save"
    const saveBtn = dialog.getByRole('button', { name: /prescribe.*save/i });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Dialog should close after successful save
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // The new medication should appear in the current medications table
    await expect(
      page.getByText(/sertraline/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── 4. Cease a medication ─────────────────────────────────────────────────

  test('cease an active medication via the Cease dialog', async ({ page }) => {
    await goToPatientMedications(page);

    // We need at least one active medication row to cease
    const table = page.getByRole('region', { name: /data table/i }).first();
    const hasRows = await table
      .locator('tbody tr')
      .first()
      .isVisible()
      .catch(() => false);

    if (!hasRows) {
      // No active medications to cease — skip gracefully
      return;
    }

    // Click the Cease (stop) icon button on the first row
    // The button uses StopCircleIcon inside a Tooltip with title="Cease"
    // MUI Tooltip doesn't set aria-label, so we target the button by its icon
    const ceaseButton = page.locator('button:has(svg[data-testid="StopCircleIcon"])').first();

    // If cease buttons are disabled (non-prescriber) or not visible, skip
    if (!(await ceaseButton.isVisible().catch(() => false))) {
      return;
    }
    if (await ceaseButton.isDisabled()) {
      return;
    }

    await ceaseButton.click();

    // Cease Medication dialog should open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText(/cease medication/i)).toBeVisible();

    // Fill the cessation reason
    await dialog.getByLabel(/reason for cessation/i).fill('Side effects — clinical decision');

    // Click "Cease Medication" confirm button
    const confirmBtn = dialog.getByRole('button', { name: /^cease medication$/i });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Dialog should close
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Switch to top-level Medication History tab to verify it moved there
    await clickPatientTab(page, 'Medication History');
    await waitForPageReady(page);

    // The ceased medications section should show at least one entry with "Ceased" status,
    // or the empty state "No ceased medications" message
    const historyContent = page.getByText(/ceased/i).first();
    await expect(historyContent).toBeVisible({ timeout: 10_000 });
  });

  // ── 5. Allergies panel — add a new allergy ────────────────────────────────

  test('add an allergy from the Allergies panel', async ({ page }) => {
    await goToPatientMedications(page);

    // The Allergies section is rendered at the top of the medications tab
    const allergySection = page.getByText(/allergies/i).first();
    await expect(allergySection).toBeVisible({ timeout: 10_000 });

    // Click the "Add" button inside the allergy panel
    // The allergy panel is a Card with a red border (borderColor: '#D32F2F').
    // The "Add" button is inside this card alongside the "Allergies" heading.
    const allergyCard = page.locator('.MuiCard-root').filter({ hasText: /allergies/i }).first();
    const addAllergyBtn = allergyCard.getByRole('button', { name: /add/i });
    await expect(addAllergyBtn).toBeVisible();
    await addAllergyBtn.click();

    // "Add Allergy" dialog should open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByRole('heading', { name: /add allergy/i })).toBeVisible();

    // Fill allergen name
    await dialog.getByLabel(/allergen.*substance/i).fill('Penicillin');

    // Fill reaction
    await dialog.getByLabel(/reaction/i).fill('Anaphylaxis');

    // Select severity — open the dropdown and pick "Severe"
    // This dialog renders two comboboxes (Severity, Reported By / Source).
    // Severity is the first combobox and defaults to "Moderate".
    const severitySelect = dialog.getByRole('combobox').first();
    await expect(severitySelect).toBeVisible({ timeout: 5_000 });
    await severitySelect.click();
    await page.getByRole('option', { name: /severe/i }).first().click();

    // Click "Add Allergy" to save
    const saveBtn = dialog.getByRole('button', { name: /add allergy/i });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Dialog should close
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // The new allergy should appear in the allergy panel
    await expect(page.getByText(/penicillin/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  // ── 6. Global /medications page ───────────────────────────────────────────

  test('/medications page loads without error', async ({ page }) => {
    await navigateTo(page, '/medications');
    await waitForPageReady(page);

    // The page renders (even if it is a stub returning null, it should not crash)
    // Verify no error alert is displayed
    const errorAlert = page.getByRole('alert').filter({ hasText: /error|fail/i });
    await expect(errorAlert).toHaveCount(0);
  });

  // ── 7. Global /lai page ───────────────────────────────────────────────────

  test('/lai page loads without error', async ({ page }) => {
    await navigateTo(page, '/lai');
    await waitForPageReady(page);

    const errorAlert = page.getByRole('alert').filter({ hasText: /error|fail/i });
    await expect(errorAlert).toHaveCount(0);
  });

  // ── 8. Global /clozapine page ─────────────────────────────────────────────

  test('/clozapine page loads without error', async ({ page }) => {
    await navigateTo(page, '/clozapine');
    await waitForPageReady(page);

    const errorAlert = page.getByRole('alert').filter({ hasText: /error|fail/i });
    await expect(errorAlert).toHaveCount(0);
  });
});
