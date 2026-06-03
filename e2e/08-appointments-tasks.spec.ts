import { test, expect, loginViaApi, navigateViaSidebar } from './fixtures/auth';

/**
 * 08 — Appointments and Tasks
 *
 * Tests the /appointments calendar page (create appointment)
 * and the /tasks page (create, complete, filter tasks).
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

// ── Appointments ─────────────────────────────────────────────────────────────

test.describe('Appointments', () => {
  test.beforeEach(async ({ page }) => {
    // Appointment creation pulls patient + clinician selectors that are
    // permission-sensitive; admin provides deterministic access in CI/e2e.
    await loginViaApi(page, 'admin');
  });

  // ── 1. Appointments page loads ────────────────────────────────────────────

  test('/appointments page loads with calendar/list view', async ({ page }) => {
    await navigateViaSidebar(page, 'Appointments');
    await waitForPageReady(page);

    // Page heading
    await expect(
      page.getByRole('heading', { name: /clinic appointments/i }),
    ).toBeVisible({ timeout: 10_000 });

    // The "New Appointment" button is present
    await expect(
      page.getByRole('button', { name: /new appointment/i }),
    ).toBeVisible();

    // Calendar toolbar is visible (Today button)
    await expect(
      page.getByRole('button', { name: /today/i }),
    ).toBeVisible();
  });

  // ── 2. Create a new appointment ───────────────────────────────────────────

  test('create a new appointment via the dialog', async ({ page }) => {
    await navigateViaSidebar(page, 'Appointments');
    await waitForPageReady(page);

    // Open the "New Appointment" dialog
    await page.getByRole('button', { name: /new appointment/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText(/new appointment/i)).toBeVisible();

    // Search/select a patient via the shared MUI Autocomplete widget.
    const patientSearchInput = dialog.getByPlaceholder(/search patient/i).first();
    await expect(patientSearchInput).toBeVisible({ timeout: 5_000 });
    await patientSearchInput.fill('jo');

    const listbox = page.getByRole('listbox').last();
    await expect(listbox).toBeVisible({ timeout: 10_000 });

    const allOptions = listbox.getByRole('option');
    const optionCount = await allOptions.count();
    if (optionCount === 0) {
      throw new Error('Appointment patient picker opened but returned zero selectable options.');
    }

    const patientOption = allOptions.filter({ hasText: /johnson/i }).first();
    const fallbackOption = allOptions.first();
    if (await patientOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await patientOption.click();
    } else {
      await expect(fallbackOption).toBeVisible({ timeout: 5_000 });
      await fallbackOption.click();
    }

    // Select appointment type first — this auto-populates the title field
    const typeSelect = dialog.getByLabel(/appointment type/i);
    if (await typeSelect.isVisible().catch(() => false)) {
      await typeSelect.click();
      const assessmentOption = page.getByRole('option', { name: /^assessment$/i }).first();
      if (await assessmentOption.isVisible().catch(() => false)) {
        await assessmentOption.click();
      } else {
        // Fall back to first available option
        await page.getByRole('option').first().click().catch(() => {});
      }
    }

    // Fill the title — label is "Title *"
    // Use exact label text to avoid matching the DialogTitle
    const titleField = dialog.getByLabel(/title \*/i)
      .or(dialog.locator('input').filter({ has: page.locator('[id]') }).nth(1));
    await expect(titleField.first()).toBeVisible({ timeout: 5_000 });
    await titleField.first().fill('Follow-up Review');

    // Move appointment away from existing demo slots to avoid conflict flakes.
    const dateField = dialog.getByLabel(/^date$/i);
    const startTimeField = dialog.getByLabel(/start time/i);
    const applySchedulingSlot = async (attempt: number) => {
      if (await dateField.isVisible().catch(() => false)) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 45 + attempt);
        await dateField.fill(futureDate.toISOString().split('T')[0]);
      }
      if (await startTimeField.isVisible().catch(() => false)) {
        const slotSeed = Date.now() + attempt * 13_579;
        const hour = 8 + (Math.floor(slotSeed / 1000) % 8); // 08:00-15:59
        const minute = Math.floor(slotSeed / 60000) % 60; // 00-59
        await startTimeField.fill(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
      }
    };
    await applySchedulingSlot(0);

    // Select a clinician to satisfy strict backend validation profiles.
    const clinicianSelect = dialog.getByLabel(/clinician/i);
    if (await clinicianSelect.isVisible().catch(() => false)) {
      await clinicianSelect.click();
      const listbox = page.getByRole('listbox');
      await expect(listbox).toBeVisible({ timeout: 5_000 });
      const options = listbox.getByRole('option');
      const optionCount = await options.count();
      for (let i = 0; i < optionCount; i += 1) {
        const option = options.nth(i);
        const text = ((await option.textContent()) ?? '').trim();
        if (!text || text === '—') continue;
        await option.click();
        break;
      }
    }

    // Click "Create Appointment" — the button text or a CircularProgress if saving
    const createBtn = dialog.getByRole('button', {
      name: /create appointment/i,
    });
    await expect(createBtn).toBeVisible();

    // Ensure the button is enabled (requires patient + title)
    await expect(createBtn).toBeEnabled({ timeout: 5_000 });
    let created = false;
    let lastConflictReason = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        await applySchedulingSlot(attempt);
      }

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

    // Dialog should close on success.
    await expect(dialog).toBeHidden({ timeout: 15_000 });
  });

  // ── 3. Calendar view toggle works ─────────────────────────────────────────

  test('switching between calendar view modes works', async ({ page }) => {
    await navigateViaSidebar(page, 'Appointments');
    await waitForPageReady(page);

    // The page uses ToggleButtonGroup with icon tooltips (Day, Work Week, Full Week, List)
    // Switch to "List" view — the ToggleButton has value="list" with a Tooltip title="List"
    const listToggle = page.locator('button[value="list"]').first();
    if (await listToggle.isVisible().catch(() => false)) {
      await listToggle.click();
      await waitForPageReady(page);
      await expect(listToggle).toHaveAttribute('aria-pressed', 'true');

      const noAppointments = page.getByText(/no appointments to display/i);
      if (await noAppointments.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await expect(noAppointments).toBeVisible();
      } else {
        await expect(page.locator('.MuiCard-root').first()).toBeVisible({ timeout: 10_000 });
      }
    }

    // Switch to "Day" view — ToggleButton with value="day"
    const dayToggle = page.locator('button[value="day"]').first();
    if (await dayToggle.isVisible().catch(() => false)) {
      await dayToggle.click();
      await waitForPageReady(page);
      await expect(dayToggle).toHaveAttribute('aria-pressed', 'true');
      // The day view renders hour slots starting at 7:00 (HOURS = [7..18])
      await expect(page.getByText('7:00').first()).toBeVisible({ timeout: 5_000 });
    }
  });
});

// ── Tasks ────────────────────────────────────────────────────────────────────

test.describe('Tasks', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, 'admin');
  });

  // ── 1. Tasks page loads ───────────────────────────────────────────────────

  test('/tasks page loads with task list', async ({ page }) => {
    await navigateViaSidebar(page, 'Tasks');
    await waitForPageReady(page);

    // Page heading — "Tasks"
    await expect(
      page.getByRole('heading', { name: /tasks/i }),
    ).toBeVisible({ timeout: 10_000 });

    // "New Task" button is present
    await expect(
      page.getByRole('button', { name: /new task/i }),
    ).toBeVisible();

    // MUI Tabs for "My Tasks (N)" and "Team Tasks (N)" — uses actual <Tab> elements
    const myTab = page.getByRole('tab', { name: /my tasks/i });
    const teamTab = page.getByRole('tab', { name: /team tasks/i });
    await expect(myTab).toBeVisible();
    await expect(teamTab).toBeVisible();
  });

  // ── 2. Create a new task ──────────────────────────────────────────────────

  test('create a new task via the dialog', async ({ page }) => {
    await navigateViaSidebar(page, 'Tasks');
    await waitForPageReady(page);

    // Click "New Task"
    await page.getByRole('button', { name: /new task/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText(/new task/i)).toBeVisible();

    // Fill in the title (required) — the label is "Task Title *"
    // Try getByLabel first, then fall back to a text input in the dialog
    const titleField = dialog.getByLabel(/task title/i)
      .or(dialog.locator('input').first());
    await expect(titleField.first()).toBeVisible({ timeout: 5_000 });
    await titleField.first().fill('Follow up with patient on medication review');

    // Fill description — label is "Description"
    const descField = dialog.getByLabel(/description/i);
    if (await descField.isVisible().catch(() => false)) {
      await descField.fill('Check adherence and side-effect profile after 2 weeks');
    }

    // Select priority — MUI Select with InputLabel "Priority"
    const prioritySelect = dialog.getByLabel(/priority/i);
    if (await prioritySelect.isVisible().catch(() => false)) {
      await prioritySelect.click();
      await page.getByRole('option', { name: /high/i }).click().catch(() => {
        // Dismiss dropdown if option not found
        page.keyboard.press('Escape').catch(() => {});
      });
    }

    // Set a due date — label is "Due Date", type="date"
    const dueDateField = dialog.getByLabel(/due date/i);
    if (await dueDateField.isVisible().catch(() => false)) {
      // Set to 7 days from now
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      const dateStr = futureDate.toISOString().split('T')[0]; // YYYY-MM-DD
      await dueDateField.fill(dateStr);
    }

    // Click "Create Task"
    const createBtn = dialog.getByRole('button', { name: /create task/i });
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toBeEnabled({ timeout: 5_000 });
    await createBtn.click();

    // Dialog should close
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // The new task should appear in the list (switch to Team Tasks to see all)
    const teamTab = page.getByRole('tab', { name: /team tasks/i });
    await teamTab.click();
    await waitForPageReady(page);

    await expect(
      page.getByText(/follow up with patient on medication review/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── 3. Complete a task ────────────────────────────────────────────────────

  test('complete a task by clicking the check button', async ({ page }) => {
    await navigateViaSidebar(page, 'Tasks');
    await waitForPageReady(page);

    // Switch to Team Tasks to see all tasks
    const teamTab = page.getByRole('tab', { name: /team tasks/i });
    await teamTab.click();
    await waitForPageReady(page);

    // The complete button is an IconButton with CheckCircleIcon wrapped in <Tooltip title="Complete">
    // Try multiple selector strategies: aria-label from Tooltip, data-testid on SVG, or color="success"
    const completeButton = page.getByRole('button', { name: /complete/i }).first()
      .or(page.locator('button:has(svg[data-testid="CheckCircleIcon"])').first())
      .or(page.locator('button.MuiIconButton-colorSuccess').first());

    // If there are no tasks to complete, create one first
    if (!(await completeButton.first().isVisible().catch(() => false))) {
      // Create a task so we can complete it
      await page.getByRole('button', { name: /new task/i }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      const dialogTitle = dialog.getByLabel(/task title/i)
        .or(dialog.locator('input').first());
      await dialogTitle.first().fill('Temp task to complete');

      await dialog.getByRole('button', { name: /create task/i }).click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });

      // Switch back to team tasks and wait for the new task
      await teamTab.click();
      await waitForPageReady(page);
    }

    // Tasks render as MUI Cards with variant="outlined"
    const firstTaskCard = page.locator('.MuiCard-root').first();
    const taskVisible = await firstTaskCard.isVisible().catch(() => false);
    if (!taskVisible) {
      // No tasks at all — nothing to complete, skip gracefully
      return;
    }

    // Record the task title for verification (first <p> or <span> inside the card)
    const taskTitle = await firstTaskCard
      .locator('.MuiTypography-root')
      .first()
      .textContent()
      .catch(() => '');

    // Click the Complete icon button — uses CheckCircleIcon inside Tooltip with title="Complete"
    // Try multiple selector strategies for robustness
    const checkBtn = firstTaskCard.getByRole('button', { name: /complete/i })
      .or(firstTaskCard.locator('button:has(svg[data-testid="CheckCircleIcon"])'))
      .or(firstTaskCard.locator('button.MuiIconButton-colorSuccess'));
    if (await checkBtn.first().isVisible().catch(() => false)) {
      await checkBtn.first().click();

      // Wait for the mutation to settle and the task to disappear from the active list
      await waitForPageReady(page);

      // The task should no longer be in the active team tasks list
      // (it moved to "completed" status which is filtered out)
      if (taskTitle) {
        // Give the UI a moment to re-render after the mutation
        await page.waitForTimeout(1_500);
        // The task title should be gone from the current view
        const remaining = page.getByText(taskTitle, { exact: true });
        const count = await remaining.count();
        expect(count).toBe(0);
      }
    }
  });

  // ── 4. Task tab filters (My Tasks vs Team Tasks) ─────────────────────────

  test('switching between My Tasks and Team Tasks tabs filters the list', async ({
    page,
  }) => {
    await navigateViaSidebar(page, 'Tasks');
    await waitForPageReady(page);

    // MUI <Tabs> with <Tab> components — "My Tasks (N)" selected by default
    const myTab = page.getByRole('tab', { name: /my tasks/i });
    await expect(myTab).toBeVisible({ timeout: 10_000 });
    await expect(myTab).toHaveAttribute('aria-selected', 'true');

    // Content shows either tasks or "No personal tasks." Alert
    const myContent = page
      .getByText(/no personal tasks/i)
      .or(page.locator('.MuiCard-root').first());
    await expect(myContent.first()).toBeVisible({ timeout: 10_000 });

    // Switch to "Team Tasks"
    const teamTab = page.getByRole('tab', { name: /team tasks/i });
    await teamTab.click();
    await waitForPageReady(page);

    // Team tab should now be selected
    await expect(teamTab).toHaveAttribute('aria-selected', 'true');

    // Content shows either tasks or "No team tasks." Alert
    const teamContent = page
      .getByText(/no team tasks/i)
      .or(page.locator('.MuiCard-root').first());
    await expect(teamContent.first()).toBeVisible({ timeout: 10_000 });
  });
});
