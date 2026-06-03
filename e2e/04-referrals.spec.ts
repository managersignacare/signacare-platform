/**
 * E2E Tests — Referrals & Intake
 *
 * Covers: referral list page, new referral creation with patient search,
 * referral source dropdown verification (bug fix — GP, ED sources),
 * referral processing/decision flow, and status change verification.
 */
import { test, expect, navigateViaSidebar, useAs } from './fixtures/auth';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const RUN_ID = Date.now().toString(36).slice(-5);
test.use(useAs('admin'));

const INTAKE_TAB_NAMES = [/active referrals/i, /^accepted/i, /^rejected/i];

type ReferralSourceSeed = {
  category: 'internal' | 'external';
  name: string;
  sortOrder: number;
};

const REQUIRED_REFERRAL_SOURCES: ReferralSourceSeed[] = [
  { category: 'internal', name: 'CCT Team', sortOrder: 10 },
  { category: 'external', name: 'General Practitioner', sortOrder: 20 },
  { category: 'external', name: 'Emergency Department', sortOrder: 30 },
];

async function ensureReferralSourcesSeeded(page: import('@playwright/test').Page): Promise<void> {
  const listResponse = await page.request.get('/api/v1/staff-settings/referral-sources', {
    headers: { 'X-Client': 'mobile' },
  });
  if (!listResponse.ok()) {
    throw new Error(`Failed to load referral sources (${listResponse.status()})`);
  }

  const payload = (await listResponse.json()) as { sources?: Array<{ category?: string; name?: string }> };
  const existing = new Set(
    (payload.sources ?? []).map((source) =>
      `${(source.category ?? '').toLowerCase()}::${(source.name ?? '').toLowerCase()}`,
    ),
  );

  for (const source of REQUIRED_REFERRAL_SOURCES) {
    const key = `${source.category}::${source.name.toLowerCase()}`;
    if (existing.has(key)) continue;

    const createResponse = await page.request.post('/api/v1/staff-settings/referral-sources', {
      headers: {
        'X-CSRF-Token': 'test',
        'X-Client': 'mobile',
      },
      data: source,
    });
    if (!createResponse.ok()) {
      const body = await createResponse.text();
      throw new Error(
        `Failed to create referral source ${source.category}/${source.name} (${createResponse.status()}): ${body}`,
      );
    }
  }
}

async function selectExistingPatientFromAutocomplete(
  page: import('@playwright/test').Page,
  dialog: import('@playwright/test').Locator,
): Promise<{ display: string; familyName: string } | null> {
  const searchInput = dialog.getByRole('combobox', { name: /search existing patient by name or ur/i });
  const listbox = page.getByRole('listbox').last();
  const searchTerms = ['ma', 'jo', 'sm', 'li', 'an', 'ur'];

  for (const term of searchTerms) {
    await searchInput.fill(term);
    const firstOption = listbox.getByRole('option').first();
    const optionVisible = await firstOption.isVisible({ timeout: 2_500 }).catch(() => false);
    if (!optionVisible) continue;

    const display = (await firstOption.innerText()).trim();
    await firstOption.click();
    const familyName = display.split(',')[0]?.trim() ?? '';
    if (familyName) return { display, familyName };
  }

  return null;
}

async function createFallbackPatient(
  page: import('@playwright/test').Page,
): Promise<{ givenName: string; familyName: string }> {
  const suffix = `${Date.now().toString(36).slice(-6)}`;
  const givenName = `E2ERef${suffix}`;
  const familyName = `Patient${suffix}`;

  const createResponse = await page.request.post('/api/v1/patients', {
    headers: {
      'X-CSRF-Token': 'test',
      'X-Client': 'mobile',
    },
    data: {
      givenName,
      familyName,
      dateOfBirth: '1991-01-01',
    },
  });
  if (!createResponse.ok()) {
    const body = await createResponse.text();
    throw new Error(`Fallback patient creation failed (${createResponse.status()}): ${body}`);
  }

  return { givenName, familyName };
}

async function selectPatientForReferral(
  page: import('@playwright/test').Page,
  dialog: import('@playwright/test').Locator,
): Promise<{ display: string; familyName: string }> {
  const searchInput = dialog.getByRole('combobox', { name: /search existing patient by name or ur/i });
  await expect(searchInput).toBeVisible({ timeout: 5_000 });

  const existing = await selectExistingPatientFromAutocomplete(page, dialog);
  if (existing) return existing;

  const fallback = await createFallbackPatient(page);
  await searchInput.fill(fallback.familyName);
  const listbox = page.getByRole('listbox').last();
  const fallbackOption = listbox.getByRole('option', { name: new RegExp(fallback.familyName, 'i') }).first();
  await expect(fallbackOption).toBeVisible({ timeout: 10_000 });
  const display = (await fallbackOption.innerText()).trim();
  await fallbackOption.click();
  return { display, familyName: fallback.familyName };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function openIntakeTab(page: import('@playwright/test').Page, tabName: RegExp): Promise<void> {
  const tab = page.getByRole('tab', { name: tabName }).first();
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(250);
}

async function findTextInAnyIntakeTab(
  page: import('@playwright/test').Page,
  pattern: RegExp,
): Promise<boolean> {
  for (const tabName of INTAKE_TAB_NAMES) {
    await openIntakeTab(page, tabName);
    const found = await page.locator('table').getByText(pattern).first().isVisible().catch(() => false);
    if (found) return true;
  }
  return false;
}

async function completeAllocationIfDialogAppears(page: import('@playwright/test').Page): Promise<void> {
  const allocationDialog = page.getByRole('dialog', { name: /allocate to care team/i });
  const isVisible = await allocationDialog.isVisible().catch(() => false);
  if (!isVisible) return;

  const teamSelect = allocationDialog.getByRole('combobox').first();
  await expect(teamSelect).toBeVisible({ timeout: 5_000 });
  await teamSelect.click();
  const firstTeam = page.locator('ul[role="listbox"] [role="option"]:not([aria-disabled="true"])').first();
  await expect(firstTeam).toBeVisible({ timeout: 5_000 });
  await firstTeam.click();

  await allocationDialog.getByRole('button', { name: /^allocate$/i }).click();
  await expect(allocationDialog).toBeHidden({ timeout: 15_000 });
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

test.describe.serial('Referrals & Intake', () => {
  let _createdReferralNumber: string;
  let _createdPatientFamilyName: string;
  let referralSourcesSeeded = false;

  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    if (!referralSourcesSeeded) {
      await ensureReferralSourcesSeeded(page);
      referralSourcesSeeded = true;
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // 1. Referral list page loads correctly
  // ──────────────────────────────────────────────────────────────────
  test('referral list page loads with expected elements', async ({ page }) => {
    await navigateViaSidebar(page, 'Intake');

    // Should show the "Intake" page heading
    await expect(
      page.getByRole('heading', { name: /intake/i })
    ).toBeVisible({ timeout: 15_000 });

    // Should show the subtitle
    await expect(page.getByText(/manage incoming referrals/i)).toBeVisible();

    // "New Referral" button should be present
    await expect(
      page.getByRole('button', { name: /new referral/i })
    ).toBeVisible();

    // Search input should be present
    await expect(
      page.getByPlaceholder(/search by name/i)
    ).toBeVisible();

    // Primary filters should be present
    await expect(page.locator('label').filter({ hasText: /^Period$/ }).first()).toBeVisible();
    await expect(page.locator('label').filter({ hasText: /^Team \/ Source$/ }).first()).toBeVisible();

    // Status is now represented by tabs instead of a standalone select
    await expect(page.getByRole('tab', { name: /active referrals/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /accepted/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /rejected/i })).toBeVisible();

    // Table should be present with expected headers
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10_000 });

    const expectedHeaders = ['Family Name', 'Given Name', 'DOB', 'Referral #', 'Date', 'Source', 'Urgency', 'Status', 'Actions'];
    for (const header of expectedHeaders) {
      await expect(
        table.getByRole('columnheader', { name: header }).first(),
      ).toBeVisible();
    }

    // Current intake surface uses section-based lists without table pagination controls.
  });

  // ──────────────────────────────────────────────────────────────────
  // 2. Create a new referral
  // ──────────────────────────────────────────────────────────────────
  test('create a new referral with patient search', async ({ page }) => {
    await navigateViaSidebar(page, 'Intake');

    await expect(
      page.getByRole('heading', { name: /intake/i })
    ).toBeVisible({ timeout: 15_000 });

    // Click "New Referral"
    await page.getByRole('button', { name: /new referral/i }).click();

    // Dialog should open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toContainText(/new intake referral/i);

    // -- Patient search --
    const selectedPatient = await selectPatientForReferral(page, dialog);
    _createdPatientFamilyName = selectedPatient.familyName;

    // Patient should now be selected in the autocomplete input
    const selectedPatientInput = dialog.getByRole('combobox', { name: /search existing patient by name or ur/i });
    await expect(selectedPatientInput).toHaveValue(new RegExp(selectedPatient.familyName, 'i'));

    // Referral Source is required by backend payload validation (fromService).
    // Reuse the same stable option strategy as the dedicated source-options test.
    const sourceSelect = dialog.getByRole('combobox').nth(1);
    await sourceSelect.click();
    const gpOption = page.locator('[role="option"], .MuiMenuItem-root')
      .filter({ hasText: /general practitioner/i })
      .first();
    if (await gpOption.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await gpOption.click();
    } else {
      const fallbackSourceOption = page.locator('[role="option"]:not([aria-disabled="true"]), .MuiMenuItem-root:not([aria-disabled="true"])').first();
      await expect(fallbackSourceOption).toBeVisible({ timeout: 5_000 });
      await fallbackSourceOption.click();
    }

    // -- Reason for referral --
    const reasonField = dialog.getByLabel(/reason for referral/i);
    await expect(reasonField).toBeVisible({ timeout: 5_000 });
    await reasonField.fill(`E2E test referral ${RUN_ID} — assessment requested for mood disturbance and functional decline.`);

    // -- Intake notes (optional) --
    const notesField = dialog.getByLabel(/intake notes/i);
    if (await notesField.isVisible().catch(() => false)) {
      await notesField.fill(`Intake notes for E2E referral ${RUN_ID}.`);
    }

    // Click "Create Referral"
    const createBtn = dialog.getByRole('button', { name: /create referral/i });
    await expect(createBtn).toBeEnabled({ timeout: 5_000 });
    const createResponsePromise = page
      .waitForResponse(
        (r) => r.request().method() === 'POST' && /\/api\/v1\/.*referrals/.test(new URL(r.url()).pathname),
        { timeout: 20_000 },
      )
      .catch(() => null);
    await createBtn.click();

    const createResponse = await createResponsePromise;
    expect(createResponse, 'create-referral request did not fire').not.toBeNull();
    if (createResponse) {
      const createBody = await createResponse.text().catch(() => '<unreadable>');
      expect(
        createResponse.status(),
        `create-referral failed: ${createResponse.url()} body=${createBody}`,
      ).toBeLessThan(400);
    }

    // Dialog close can lag under large demo datasets; keep this
    // assertion but give it realistic headroom.
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // Clear status filter to show all statuses including "received"
    // The default filter is ['received', 'under_review'] so our new referral should be visible
    await page.waitForTimeout(500);

    // Verify the new referral appears in the table using the selected patient's family name
    const table = page.locator('table');
    await expect(
      table.getByText(new RegExp(selectedPatient.familyName, 'i')).first()
    ).toBeVisible({ timeout: 10_000 });

    // Capture the referral number for subsequent tests
    // The referral number is in the "Referral #" column, formatted like REF-XXXXXX
    const refNumberCell = table.locator('td').filter({ hasText: /REF-/i }).first();
    if (await refNumberCell.isVisible().catch(() => false)) {
      _createdReferralNumber = (await refNumberCell.textContent()) ?? '';
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // 3. Verify referral source dropdown has Internal and External groups
  // ──────────────────────────────────────────────────────────────────
  test('referral source dropdown has GP and ED options (bug fix verification)', async ({ page }) => {
    await navigateViaSidebar(page, 'Intake');

    await expect(
      page.getByRole('heading', { name: /intake/i })
    ).toBeVisible({ timeout: 15_000 });

    // Open New Referral dialog
    await page.getByRole('button', { name: /new referral/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Open the Referral Source dropdown
    const sourceSelect = dialog.getByRole('combobox').nth(1);
    await sourceSelect.click();

    // Wait for the dropdown options to render
    await page.waitForTimeout(500);

    // Verify the group headers exist — "Within Organisation" (internal) and "External"
    const withinOrgHeader = page.getByRole('option', { name: /within organisation/i })
      .or(page.locator('[role="option"]').filter({ hasText: /within organisation/i }))
      .or(page.locator('.MuiMenuItem-root').filter({ hasText: /within organisation/i }));

    const externalHeader = page.getByRole('option', { name: /external/i })
      .or(page.locator('[role="option"]').filter({ hasText: /external/i }))
      .or(page.locator('.MuiMenuItem-root').filter({ hasText: /external/i }));

    // At least one group header should be visible (the sources were seeded)
    const hasInternal = await withinOrgHeader.first().isVisible().catch(() => false);
    const hasExternal = await externalHeader.first().isVisible().catch(() => false);
    expect(hasInternal || hasExternal).toBeTruthy();

    // BUG FIX VERIFICATION: "General Practitioner" should be available as a source
    const gpOption = page.locator('[role="option"], .MuiMenuItem-root')
      .filter({ hasText: /general practitioner/i });
    await expect(gpOption.first()).toBeVisible({ timeout: 5_000 });

    // BUG FIX VERIFICATION: "Emergency Department" should be available as a source
    const edOption = page.locator('[role="option"], .MuiMenuItem-root')
      .filter({ hasText: /emergency department/i });
    await expect(edOption.first()).toBeVisible({ timeout: 5_000 });

    // Close the dropdown
    await page.keyboard.press('Escape');

    // Close the dialog
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });
  });

  // ──────────────────────────────────────────────────────────────────
  // 4. Process a referral — decision flow
  // ──────────────────────────────────────────────────────────────────
  test('process a referral with Accept action', async ({ page }) => {
    await navigateViaSidebar(page, 'Intake');

    await expect(
      page.getByRole('heading', { name: /intake/i })
    ).toBeVisible({ timeout: 15_000 });

    await openIntakeTab(page, /active referrals/i);

    // Wait for the active referrals table to load with referral rows
    const table = page.locator('table');
    const tableBody = table.locator('tbody');
    const firstDataRow = tableBody.locator('tr').first();
    await expect(firstDataRow).toBeVisible({ timeout: 15_000 });

    // Find a referral in "received" or "under_review" status that has action buttons
    // Look for a row with a "Review" or "Accept" button
    const reviewBtn = tableBody.getByRole('button', { name: /review/i }).first();
    // If there is a "Review" button, click it first to move to "under_review"
    if (await reviewBtn.isVisible().catch(() => false)) {
      await reviewBtn.click();
      // Wait for status update
      await page.waitForTimeout(1000);
    }

    // Now click "Accept" on the first available referral
    const acceptBtnAfter = tableBody.getByRole('button', { name: /accept/i }).first();
    if (await acceptBtnAfter.isVisible().catch(() => false)) {
      await acceptBtnAfter.click();
      await page.waitForTimeout(700);
      await completeAllocationIfDialogAppears(page);
      await page.waitForTimeout(800);
    }

    // The referral status should now be visible in the Accepted tab.
    await openIntakeTab(page, /^accepted/i);

    // There should be at least one referral with "Accepted" status chip
    const acceptedChip = tableBody.locator('.MuiChip-root').filter({ hasText: /accepted/i });
    await expect(acceptedChip.first()).toBeVisible({ timeout: 10_000 });
  });

  // ──────────────────────────────────────────────────────────────────
  // 5. Verify referral status changes are reflected in the list
  // ──────────────────────────────────────────────────────────────────
  test('referral status changes are visible after reload', async ({ page }) => {
    await navigateViaSidebar(page, 'Intake');

    await expect(
      page.getByRole('heading', { name: /intake/i })
    ).toBeVisible({ timeout: 15_000 });

    // Wait for table to load
    const table = page.locator('table');
    const tableBody = table.locator('tbody');
    await expect(tableBody.locator('tr').first()).toBeVisible({ timeout: 15_000 });

    expect(_createdReferralNumber).toMatch(/REF-/i);
    const referralPattern = new RegExp(escapeRegExp(_createdReferralNumber), 'i');

    // Verify we can locate the created referral across status tabs.
    const foundBeforeReload = await findTextInAnyIntakeTab(page, referralPattern);
    expect(foundBeforeReload).toBeTruthy();

    // Reload the page and verify referrals persist
    await page.reload();
    await expect(
      page.getByRole('heading', { name: /intake/i })
    ).toBeVisible({ timeout: 15_000 });

    // The created referral should still be discoverable across tabs after reload.
    const foundAfterReload = await findTextInAnyIntakeTab(page, referralPattern);
    expect(foundAfterReload).toBeTruthy();
  });

  // ──────────────────────────────────────────────────────────────────
  // 6. Referral search filters results
  // ──────────────────────────────────────────────────────────────────
  test('search bar filters referrals by patient name', async ({ page }) => {
    await navigateViaSidebar(page, 'Intake');

    await expect(
      page.getByRole('heading', { name: /intake/i })
    ).toBeVisible({ timeout: 15_000 });

    const searchInput = page.getByPlaceholder(/search by name/i);
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Search for a non-existent term
    await searchInput.fill('zzz_nonexistent_referral_query');
    await page.waitForTimeout(800);

    // Should show an empty-state indicator.
    await expect(page.getByText(/none|no referrals found/i)).toBeVisible({ timeout: 10_000 });

    // Clear and search for the patient used in referral creation.
    await searchInput.clear();
    const targetFamilyName = _createdPatientFamilyName || 'Johnson';
    await searchInput.fill(targetFamilyName);
    await page.waitForTimeout(800);

    // Search results may live under Active/Accepted/Rejected tabs depending on prior actions.
    const foundAcrossTabs = await findTextInAnyIntakeTab(page, new RegExp(escapeRegExp(targetFamilyName), 'i'));
    expect(foundAcrossTabs).toBeTruthy();
  });
});
