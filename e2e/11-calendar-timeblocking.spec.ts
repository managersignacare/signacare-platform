import { test, expect, loginViaApi, navigateViaSidebar } from './fixtures/auth';

async function waitForPageReady(page: import('@playwright/test').Page) {
  await page.locator('[role="progressbar"]').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  await page.locator('text=/loading/i').first().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
}

async function dismissTourChrome(page: import('@playwright/test').Page) {
  const hideTourAutoPop = page.getByLabel(/hide tour auto-pop/i);
  if (await hideTourAutoPop.isVisible().catch(() => false)) {
    await hideTourAutoPop.click();
  }

  const closeTourStep = page.getByLabel(/close tour step/i);
  if (await closeTourStep.isVisible().catch(() => false)) {
    await closeTourStep.click();
  }
}

async function resolveCalendarPatient(page: import('@playwright/test').Page): Promise<{
  emrNumber: string;
  familyName: string;
  givenName: string;
  id: string;
}> {
  const result = await page.evaluate(async () => {
    const queries = ['fi', 'a1', 'ma', 'ja', 'jo'];
    for (const query of queries) {
      const response = await fetch(`/api/v1/patients?search=${encodeURIComponent(query)}&limit=5`, {
        credentials: 'include',
        headers: {
          'X-CSRF-Token': 'test',
          'X-Client': 'web',
        },
      });
      if (!response.ok) {
        continue;
      }
      const payload = await response.json() as {
        data?: Array<{
          emrNumber: string;
          familyName: string;
          givenName: string;
          id: string;
        }>;
      };
      const patient = payload.data?.[0];
      if (patient) {
        return patient;
      }
    }
    return null;
  });

  if (!result) {
    throw new Error('Unable to resolve a searchable patient from the authenticated calendar session.');
  }

  return result;
}

function timeBlockingCard(page: import('@playwright/test').Page) {
  return page.locator('.MuiPaper-root').filter({
    has: page.getByRole('heading', { name: /^time blocking$/i }),
  }).first();
}

function futureSchedulingSlot(attempt: number): { date: string; startTime: string } {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 2 + attempt);
  return {
    date: futureDate.toISOString().split('T')[0],
    // Keep the E2E proof timezone-stable against the clinic-hours gate.
    // The appointment dialog serialises a local date+time pair; using an
    // early morning slot can drift outside the clinic's Australia/Melbourne
    // operating window when the browser/test host timezone differs.
    startTime: '21:00',
  };
}

test.describe('My Calendar + Time Blocking', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, 'admin');
  });

  test('My Calendar loads as the canonical scheduling workspace', async ({ page }) => {
    await navigateViaSidebar(page, 'My Calendar');
    await waitForPageReady(page);
    await dismissTourChrome(page);

    await expect(page.getByRole('heading', { name: /my calendar/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/One scheduling surface for clinician, team, and clinic appointments/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /new appointment/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /refresh calendar/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sync setup/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^calendar$/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^contacts$/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^dna$/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^time blocking$/i })).toBeVisible();
  });

  test('create an appointment from My Calendar', async ({ page }) => {
    await navigateViaSidebar(page, 'My Calendar');
    await waitForPageReady(page);
    await dismissTourChrome(page);
    const patient = await resolveCalendarPatient(page);

    await page.getByRole('button', { name: /new appointment/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText(/new appointment/i)).toBeVisible();

    const patientSearchInput = dialog.getByPlaceholder(/search patient/i).first();
    await expect(patientSearchInput).toBeVisible({ timeout: 5_000 });
    const patientSearchTerm = patient.familyName.slice(0, 2);
    const patientLookupResponse = page.waitForResponse(
      (response) => response.request().method() === 'GET'
        && /\/api\/v1\/patients(?:\?.*)?$/.test(response.url())
        && response.url().includes(`search=${encodeURIComponent(patientSearchTerm)}`),
      { timeout: 15_000 },
    );
    await patientSearchInput.fill(patientSearchTerm);
    await patientLookupResponse;

    const listbox = page.getByRole('listbox').filter({ has: page.getByRole('option') }).first();
    await expect(listbox).toBeVisible({ timeout: 10_000 });
    const allOptions = listbox.getByRole('option');
    const optionCount = await allOptions.count();
    if (optionCount === 0) {
      throw new Error('My Calendar appointment patient picker returned zero selectable options.');
    }

    const patientOption = allOptions.filter({
      hasText: new RegExp(`${patient.familyName}.*${patient.givenName}|${patient.givenName}.*${patient.familyName}`, 'i'),
    }).first();
    const fallbackOption = allOptions.first();
    await expect(patientOption.or(fallbackOption)).toBeVisible({ timeout: 5_000 });
    if (await patientOption.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await patientOption.click();
    } else {
      await fallbackOption.click();
    }

    const clinicianSelect = dialog.getByLabel(/^clinician$/i);
    if (await clinicianSelect.isVisible().catch(() => false)) {
      await clinicianSelect.click();
      const options = page.getByRole('option');
      const total = await options.count();
      for (let i = 0; i < total; i += 1) {
        const option = options.nth(i);
        const text = ((await option.textContent()) ?? '').trim();
        if (!text || text === '—') continue;
        await option.click();
        break;
      }
    }

    let created = false;
    let lastConflictReason = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const slot = futureSchedulingSlot(attempt);
      const dateField = dialog.getByLabel(/^date$/i);
      const startTimeField = dialog.getByLabel(/start time/i);
      if (await dateField.isVisible().catch(() => false)) {
        await dateField.fill(slot.date);
      }
      if (await startTimeField.isVisible().catch(() => false)) {
        await startTimeField.fill(slot.startTime);
      }

      const createBtn = dialog.getByRole('button', { name: /create appointment/i });
      await expect(createBtn).toBeEnabled({ timeout: 5_000 });

      const createResponsePromise = page.waitForResponse(
        (response) => response.request().method() === 'POST'
          && /\/api\/v1\/appointments(?:\?.*)?$/.test(response.url()),
        { timeout: 15_000 },
      );

      let createAlertMessage: string | null = null;
      page.once('dialog', async (alertDialog) => {
        createAlertMessage = alertDialog.message();
        await alertDialog.accept();
      });

      await createBtn.click();
      const createResponse = await createResponsePromise;
      const responseBody = await createResponse.text().catch(() => '');
      await page.waitForTimeout(400);

      const isConflict = createResponse.status() === 409
        || /APPOINTMENT_CONFLICT/i.test(responseBody)
        || /already booked/i.test(createAlertMessage ?? '');
      if (isConflict) {
        lastConflictReason = createAlertMessage ?? responseBody;
        continue;
      }

      if (createAlertMessage) {
        throw new Error(
          `Create appointment failed with alert: ${createAlertMessage} (HTTP ${createResponse.status()} ${responseBody})`.trim(),
        );
      }
      if (createResponse.status() >= 400) {
        throw new Error(
          `Create appointment API failed: HTTP ${createResponse.status()} ${responseBody}`.trim(),
        );
      }

      created = true;
      break;
    }

    if (!created) {
      throw new Error(`Create appointment repeatedly conflicted after retries: ${lastConflictReason}`);
    }

    await expect(dialog).toBeHidden({ timeout: 15_000 });
  });

  test('create, edit, and delete an inline time block', async ({ page }) => {
    await navigateViaSidebar(page, 'My Calendar');
    await waitForPageReady(page);
    await dismissTourChrome(page);

    const unique = `PW Timeblock ${Date.now()}`;
    const updated = `${unique} Updated`;
    const blockDate = new Date();
    blockDate.setDate(blockDate.getDate() + 6);
    const blockDateIso = blockDate.toISOString().slice(0, 10);
    const card = timeBlockingCard(page);

    await card.scrollIntoViewIfNeeded();

    const statusSelect = card.getByRole('combobox').nth(0);
    const recurrenceSelect = card.getByRole('combobox').nth(1);

    await statusSelect.click();
    await page.getByRole('option', { name: /free to book/i }).click();

    await recurrenceSelect.click();
    await page.getByRole('option', { name: /specific date only/i }).click();

    await card.getByLabel(/specific date/i).fill(blockDateIso);
    await card.getByLabel(/^start time$/i).fill('10:00');
    await card.getByLabel(/^end time$/i).fill('11:00');
    await card.getByLabel(/time block name/i).fill(unique);
    await card.getByLabel(/booking notes/i).fill('Green template slot for team bookings');

    const createResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST'
        && /\/api\/v1\/calendar\/blocks(?:\?.*)?$/.test(response.url()),
      { timeout: 15_000 },
    );
    await card.getByRole('button', { name: /add time block/i }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBeLessThan(400);

    const createdRule = card.getByRole('listitem').filter({ hasText: unique }).first();
    await expect(createdRule).toBeVisible({ timeout: 10_000 });

    await createdRule.getByLabel(/edit time block/i).click();
    const nameField = card.getByLabel(/time block name/i);
    await expect(nameField).toHaveValue(unique);
    await nameField.fill(updated);

    const updateResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'PUT'
        && /\/api\/v1\/calendar\/blocks\/.+$/.test(response.url()),
      { timeout: 15_000 },
    );
    await card.getByRole('button', { name: /update time block/i }).click();
    const updateResponse = await updateResponsePromise;
    expect(updateResponse.status()).toBeLessThan(400);
    await expect(card.getByRole('listitem').filter({ hasText: updated }).first()).toBeVisible({ timeout: 10_000 });

    const deleteResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'DELETE'
        && /\/api\/v1\/calendar\/blocks\/.+$/.test(response.url()),
      { timeout: 15_000 },
    );
    await card.getByRole('listitem').filter({ hasText: updated }).first().getByLabel(/delete time block/i).click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBeLessThan(400);
    await expect(card.getByRole('listitem').filter({ hasText: updated }).first()).toBeHidden({ timeout: 10_000 });
  });
});
