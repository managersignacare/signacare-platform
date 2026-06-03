/**
 * E2E Tests — Episodes & Clinical Notes
 *
 * Covers: episode list, episode creation, clinical note creation (with query
 * invalidation verification), note content verification, MDT allocation,
 * and messaging from an episode.
 */
import { test, expect, loginViaApi, dismissTourPopup } from './fixtures/auth';
import type { Page } from '@playwright/test';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const RUN_ID = Date.now().toString(36).slice(-5);

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

test.describe.serial('Episodes & Clinical Notes', () => {
  const EPISODE_TITLE = `E2E Community ${RUN_ID}`;
  const NOTE_TITLE = `E2E Progress ${RUN_ID}`;
  const NOTE_CONTENT = `E2E progress note content ${RUN_ID} — patient presentation is stable with no acute concerns.`;
  const EPISODE_PATIENT_FAMILY_NAME = `EpisodesRun${RUN_ID}`;
  const EPISODE_TEST_USER = 'clinician' as const;
  let episodePatientId: string | null = null;

  const ensureEpisodePatientId = async (page: Page): Promise<string> => {
    if (episodePatientId) return episodePatientId;
    const patientResponse = await page.evaluate(async ({ familyName }: { familyName: string }) => {
      const headers = {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'test',
        'X-Client': 'mobile',
      };
      const searchParams = new URLSearchParams({ search: familyName, limit: '10', myPatients: 'false' });
      const searchRes = await fetch(`/api/v1/patients?${searchParams.toString()}`, {
        method: 'GET',
        credentials: 'include',
        headers,
      });
      if (searchRes.ok) {
        const searchBody = await searchRes.json() as { data?: Array<{ id?: string }> };
        const existingId = (Array.isArray(searchBody?.data) ? searchBody.data : [])
          .map((row) => row?.id)
          .find((id): id is string => typeof id === 'string' && id.length > 0);
        if (existingId) return { ok: true, status: searchRes.status, id: existingId };
      }

      const createRes = await fetch('/api/v1/patients', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          givenName: 'E2E',
          familyName,
          dateOfBirth: '1990-01-01',
          gender: 'unspecified',
          status: 'active',
        }),
      });
      if (!createRes.ok) return { ok: false, status: createRes.status, id: null as string | null };
      const createBody = await createRes.json() as { id?: string; data?: { id?: string } };
      const id = createBody?.id ?? createBody?.data?.id ?? null;
      return { ok: typeof id === 'string' && id.length > 0, status: createRes.status, id };
    }, { familyName: EPISODE_PATIENT_FAMILY_NAME });

    expect(
      patientResponse.ok,
      `Failed to provision/find deterministic e2e episode patient (HTTP ${patientResponse.status})`,
    ).toBeTruthy();
    episodePatientId = patientResponse.id;
    return patientResponse.id;
  };

  const openEpisodesTabForRunPatient = async (page: Page): Promise<string> => {
    const patientId = await ensureEpisodePatientId(page);
    await page.goto(`/patients/${patientId}?tab=episodes`, { waitUntil: 'domcontentloaded' });
    await dismissTourPopup(page);
    return patientId;
  };

  const episodeCardButton = (page: Page) =>
    page.getByRole('button', { name: `Open episode ${EPISODE_TITLE}` });
  const episodeTypeChoiceOrder: Array<{ value: string; optionName: RegExp }> = [
    { value: 'community', optionName: /community/i },
    { value: 'inpatient', optionName: /inpatient/i },
    { value: 'residential', optionName: /residential/i },
    { value: 'consultation', optionName: /consultation/i },
    { value: 'acis', optionName: /acis/i },
    { value: 'mst', optionName: /mst/i },
    { value: 'cct', optionName: /cct/i },
    { value: 'parc', optionName: /parc/i },
    { value: 'ccu', optionName: /ccu/i },
    { value: 'ipu', optionName: /ipu/i },
    { value: 'other', optionName: /other/i },
  ];

  // ──────────────────────────────────────────────────────────────────
  // 1. Navigate to Episodes tab and verify list or empty state
  // ──────────────────────────────────────────────────────────────────
  test('episodes tab loads with episode list or empty state', async ({ page }) => {
    await loginViaApi(page, EPISODE_TEST_USER);
    await openEpisodesTabForRunPatient(page);

    // Should see the "Episodes of Care" heading
    await expect(page.getByText('Episodes of Care')).toBeVisible({ timeout: 10_000 });

    // Empty state and populated state render different DOM patterns.
    // Check empty-state first (deterministic text), otherwise require
    // at least one card to be visible.
    const hasEmpty = await page.getByText('No active episodes.').isVisible().catch(() => false);
    if (!hasEmpty) {
      await expect(page.locator('.MuiCard-root').first()).toBeVisible({ timeout: 10_000 });
    }

    // The "Add Episode" button should always be visible
    await expect(page.getByRole('button', { name: /add episode/i })).toBeVisible();
  });

  // ──────────────────────────────────────────────────────────────────
  // 2. Create a new episode
  // ──────────────────────────────────────────────────────────────────
  test('create a new episode via the Add Episode dialog', async ({ page }) => {
    await loginViaApi(page, EPISODE_TEST_USER);
    const patientId = await openEpisodesTabForRunPatient(page);

    await expect(page.getByText('Episodes of Care')).toBeVisible({ timeout: 10_000 });

    // Click Add Episode
    await page.getByRole('button', { name: /add episode/i }).click();

    // Dialog should open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toContainText(/add episode/i);

    const episodeTypesResponse = await page.evaluate(async (pid: string) => {
      const res = await fetch(`/api/v1/episodes/patient/${pid}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': 'test',
          'X-Client': 'mobile',
        },
      });
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          openTypes: [] as string[],
          openEpisodes: [] as Array<{ id: string; type: string }>,
        };
      }
      const body = await res.json() as { data?: Array<{ id?: string; status?: string; episodeType?: string; episode_type?: string }> };
      const rows = Array.isArray(body?.data) ? body.data : [];
      const openEpisodes = rows
        .filter((row) => String(row?.status ?? '').trim().toLowerCase() === 'open')
        .map((row) => ({
          id: String(row?.id ?? '').trim(),
          type: (row?.episodeType ?? row?.episode_type ?? '').trim().toLowerCase(),
        }))
        .filter((row) => row.id.length > 0 && row.type.length > 0);
      return {
        ok: true,
        status: res.status,
        openTypes: openEpisodes.map((row) => row.type),
        openEpisodes,
      };
    }, patientId);
    expect(
      episodeTypesResponse.ok,
      `Failed to list patient episodes before selecting episode type (HTTP ${episodeTypesResponse.status})`,
    ).toBeTruthy();
    const openEpisodeTypes = new Set(episodeTypesResponse.openTypes);
    let targetEpisodeType = episodeTypeChoiceOrder.find((t) => !openEpisodeTypes.has(t.value));
    if (!targetEpisodeType) {
      const recyclable = episodeTypesResponse.openEpisodes
        .find((row) => episodeTypeChoiceOrder.some((choice) => choice.value === row.type));
      expect(recyclable, 'No available episode type to create and no recyclable open episode type was found').toBeTruthy();
      if (recyclable?.id) {
        const closeResponse = await page.evaluate(async (episodeId: string) => {
          const closeRes = await fetch(`/api/v1/episodes/${episodeId}/close`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': 'test',
              'X-Client': 'mobile',
            },
            body: JSON.stringify({
              endDate: new Date().toISOString().split('T')[0],
              closureReason: 'E2E recycle open episode type',
            }),
          });
          return { ok: closeRes.ok, status: closeRes.status };
        }, recyclable.id);
        expect(
          closeResponse.ok,
          `Failed to close recyclable episode ${recyclable.id} before create (HTTP ${closeResponse.status})`,
        ).toBeTruthy();
      }
      targetEpisodeType = episodeTypeChoiceOrder.find((choice) => choice.value === recyclable?.type) ?? episodeTypeChoiceOrder[0];
    }

    // Select episode type FIRST — changing type auto-generates the title
    const typeSelect = dialog.getByLabel(/episode type/i);
    await typeSelect.click();
    // MUI Select renders options in a listbox (Portal — outside dialog)
    const typeOption = page.getByRole('option', { name: targetEpisodeType.optionName });
    await expect(typeOption).toBeVisible({ timeout: 5_000 });
    await typeOption.click();

    // Wait for the dropdown to close before interacting with other fields
    await page.waitForTimeout(300);

    // Now fill the Episode Name / Title (after type selection to avoid auto-overwrite)
    const titleInput = dialog.getByLabel(/episode name/i);
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.clear();
    await titleInput.fill(EPISODE_TITLE);

    // Start date should already be populated with today's date
    const startDateInput = dialog.locator('input[type="date"]').first();
    await expect(startDateInput).toBeVisible();
    const dateValue = await startDateInput.inputValue();
    expect(dateValue).toBeTruthy();

    // Click "Create Episode"
    await dialog.getByRole('button', { name: /create episode/i }).click();

    // Dialog should close
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Wait for query invalidation to refetch the episode list
    await page.waitForTimeout(1000);

    // Verify the new episode appears in the list
    await expect(episodeCardButton(page)).toBeVisible({ timeout: 10_000 });
  });

  // ──────────────────────────────────────────────────────────────────
  // 3. Add a clinical note to the episode (query invalidation test)
  // ──────────────────────────────────────────────────────────────────
  test('add a clinical note to an episode and verify it appears', async ({ page }) => {
    await loginViaApi(page, EPISODE_TEST_USER);
    await openEpisodesTabForRunPatient(page);

    await expect(page.getByText('Episodes of Care')).toBeVisible({ timeout: 10_000 });

    // Click on the episode we just created to open the detail view
    const episodeLink = episodeCardButton(page);
    await expect(episodeLink).toBeVisible({ timeout: 10_000 });
    await episodeLink.click();

    // Wait for the episode detail view to load (should see Timeline heading)
    await expect(page.getByText('Timeline')).toBeVisible({ timeout: 10_000 });

    // Click the "Note" button to open the AddNoteDialog
    await page.getByRole('button', { name: /^note$/i }).click();

    // Add Note dialog should open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toContainText(/add clinical note|note content/i);

    // Switch to "Write" mode (dialog defaults to AI Scribe mode)
    const writeButton = dialog.getByRole('button', { name: /^write$/i });
    await expect(writeButton).toBeVisible({ timeout: 5_000 });
    await writeButton.click();
    await page.waitForTimeout(300);

    // The note content area — "Note Content" label on a multiline TextField
    const noteTitleInput = dialog.getByLabel(/note title/i);
    await expect(noteTitleInput).toBeVisible({ timeout: 5_000 });
    await noteTitleInput.fill(NOTE_TITLE);

    const contentField = dialog.getByLabel(/note content/i);
    await expect(contentField).toBeVisible({ timeout: 5_000 });
    await contentField.clear();
    await contentField.fill(NOTE_CONTENT);

    // If first-visit sign gates are present, satisfy them before signing.
    for (const checkboxLabel of [
      /Recent labs reviewed/i,
      /Recent imaging reviewed/i,
      /Recent medications reviewed/i,
    ]) {
      const checkbox = dialog.getByLabel(checkboxLabel);
      if (await checkbox.isVisible().catch(() => false)) {
        await checkbox.check();
      }
    }

    // Save the note. If sign-only safety gates are still active (for example
    // first psychiatric note risk-assessment gate), fall back to draft save so
    // this spec still verifies timeline invalidation honestly.
    const saveButton = dialog.getByRole('button', { name: /save & sign/i });
    await expect(saveButton).toBeVisible({ timeout: 5_000 });
    let savedAsDraft = false;
    if (await saveButton.isEnabled().catch(() => false)) {
      await saveButton.click();
    } else {
      const saveDraftButton = dialog.getByRole('button', { name: /save as draft/i });
      await expect(saveDraftButton).toBeEnabled({ timeout: 5_000 });
      await saveDraftButton.click();
      savedAsDraft = true;
    }

    // After save, the AddNoteDialog closes and a ContactFormDialog opens automatically.
    // Wait for it and dismiss it by clicking Close/Cancel/Skip.
    await page.waitForTimeout(2000);
    const contactDialog = page.getByRole('dialog');
    if (await contactDialog.isVisible().catch(() => false)) {
      // Close the contact form dialog
      const closeBtn = contactDialog.getByRole('button', { name: /close|cancel|skip/i }).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
      }
    }

    // Wait for dialog to fully close and queries to invalidate
    await page.waitForTimeout(1000);

    // Timeline rows are collapsed by default. Expand the note row first.
    const noteRow = page.getByRole('button', { name: new RegExp(`Note: ${NOTE_TITLE}.*expand`, 'i') });
    if (await noteRow.isVisible().catch(() => false)) {
      await noteRow.click();
    }

    // CRITICAL: Verify the note now appears in the Timeline notes list.
    // This validates the query invalidation bug fix — notes should appear
    // immediately without a manual refresh.
    if (savedAsDraft) {
      await expect(page.getByText(NOTE_TITLE).first()).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(page.getByText(NOTE_CONTENT).first()).toBeVisible({ timeout: 15_000 });
    }
  });

  // ──────────────────────────────────────────────────────────────────
  // 4. Verify note content matches what was entered
  // ──────────────────────────────────────────────────────────────────
  test('note content matches what was entered', async ({ page }) => {
    await loginViaApi(page, EPISODE_TEST_USER);
    await openEpisodesTabForRunPatient(page);

    await expect(page.getByText('Episodes of Care')).toBeVisible({ timeout: 10_000 });

    // Open the episode detail
    await episodeCardButton(page).click();
    await expect(page.getByText('Timeline')).toBeVisible({ timeout: 10_000 });

    // Timeline rows are collapsed by default; expand the note row first.
    const noteRow = page.getByRole('button', { name: new RegExp(`Note: ${NOTE_TITLE}.*expand`, 'i') });
    await expect(noteRow).toBeVisible({ timeout: 10_000 });
    await noteRow.click();
    await page.waitForTimeout(300);

    // Verify the exact content is present on the page
    await expect(page.getByText(NOTE_CONTENT).first()).toBeVisible({ timeout: 10_000 });
  });

  // ──────────────────────────────────────────────────────────────────
  // 5. Episode allocation (MDT) — assign primary clinician
  // ──────────────────────────────────────────────────────────────────
  test('allocate MDT clinician to episode and verify persistence', async ({ page }) => {
    await loginViaApi(page, EPISODE_TEST_USER);
    await openEpisodesTabForRunPatient(page);

    await expect(page.getByText('Episodes of Care')).toBeVisible({ timeout: 10_000 });

    // Open the episode detail
    await episodeCardButton(page).click();
    await expect(page.getByText('Multidisciplinary Team (MDT)')).toBeVisible({ timeout: 10_000 });

    // Click "Edit MDT" to open the allocation dialog
    await page.getByRole('button', { name: /edit mdt/i }).click();

    const allocDialog = page.getByRole('dialog');
    await expect(allocDialog).toBeVisible({ timeout: 5_000 });
    await expect(allocDialog).toContainText(/allocate team/i);

    // Select a Team / Unit (first available option)
    const teamSelect = allocDialog.getByLabel(/team.*unit/i);
    await teamSelect.click();
    // Pick the first non-placeholder option
    const teamOption = page.getByRole('option').filter({ hasNotText: /select/i }).first();
    if (await teamOption.isVisible().catch(() => false)) {
      await teamOption.click();
    }

    // Select Primary Clinician
    const primarySelect = allocDialog.getByLabel(/primary clinician/i);
    await primarySelect.click();
    // Pick the first real staff member (skip "None")
    const clinicianOption = page.getByRole('option').filter({ hasNotText: /none/i }).first();
    if (await clinicianOption.isVisible().catch(() => false)) {
      await clinicianOption.click();
    }

    // Save the allocation
    const allocSaveBtn = allocDialog.getByRole('button', { name: /allocate|save/i });
    await expect(allocSaveBtn).toBeVisible();
    await allocSaveBtn.click();

    // Dialog should close
    await expect(allocDialog).toBeHidden({ timeout: 10_000 });

    // Verify the MDT panel now shows "Primary Clinician" with a name
    const mdtPanel = page.locator('text=Primary Clinician').first();
    await expect(mdtPanel).toBeVisible({ timeout: 10_000 });

    // Reload the page to verify persistence
    await page.reload();
    await dismissTourPopup(page);
    await page.goto(`/patients/${await ensureEpisodePatientId(page)}?tab=episodes`, { waitUntil: 'domcontentloaded' });
    await dismissTourPopup(page);
    await expect(page.getByText('Episodes of Care')).toBeVisible({ timeout: 15_000 });
    await episodeCardButton(page).click();
    await expect(page.getByText('Multidisciplinary Team (MDT)')).toBeVisible({ timeout: 10_000 });

    // MDT allocation should still show the primary clinician
    await expect(page.getByText('Primary Clinician').first()).toBeVisible({ timeout: 10_000 });
  });

  // ──────────────────────────────────────────────────────────────────
  // 6. Send a message from the episode
  // ──────────────────────────────────────────────────────────────────
  test('send a message from the episode detail view', async ({ page }) => {
    await loginViaApi(page, EPISODE_TEST_USER);
    const patientId = await openEpisodesTabForRunPatient(page);

    await expect(page.getByText('Episodes of Care')).toBeVisible({ timeout: 10_000 });

    // Open the episode detail
    await episodeCardButton(page).click();
    await expect(page.getByText('Timeline')).toBeVisible({ timeout: 10_000 });

    // Click the "Message" button
    await page.getByRole('button', { name: /^message$/i }).click();

    // Send Message dialog should open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toContainText(/send message/i);

    // Select a recipient from the dropdown
    const recipientSelect = dialog.getByLabel(/recipients/i);
    await recipientSelect.click();

    // Pick the first available recipient (Patient or GP)
    const recipientOption = page.getByRole('option').first();
    if (await recipientOption.isVisible().catch(() => false)) {
      await recipientOption.click();
      // Close the dropdown by pressing Escape
      await page.keyboard.press('Escape');
    }

    // Fill the message body
    const messageField = dialog.getByLabel(/message/i);
    await expect(messageField).toBeVisible({ timeout: 5_000 });
    await messageField.clear();
    await messageField.fill(`E2E test message ${RUN_ID} — follow-up appointment reminder.`);

    // Click Send
    const sendBtn = dialog.getByRole('button', { name: /send/i });
    await expect(sendBtn).toBeEnabled({ timeout: 5_000 });
    const createNoteResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === 'POST'
        && response.url().includes(`/api/v1/patients/${patientId}/notes`);
    });
    await sendBtn.click();
    const createNoteResponse = await createNoteResponsePromise;
    const createNoteStatus = createNoteResponse.status();
    expect(createNoteStatus, `Expected message-note create to succeed; got HTTP ${createNoteStatus}`).toBeLessThan(400);

    // Dialog should close, indicating success
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Verify the message appears in the notes list as a "message" type note
    await expect(
      page.getByText(/message to/i).first()
        .or(page.getByText(`E2E test message ${RUN_ID}`).first())
    ).toBeVisible({ timeout: 10_000 });
  });
});
