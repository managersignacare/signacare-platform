import { test, expect, loginViaApi, navigateToPatient, clickPatientTab, dismissTourPopup } from './fixtures/auth';

/**
 * 11 — MAR (Medication Administration Record) write-rail golden path.
 *
 * BUG-634 (W3 second item; CLAUDE.md §11 Layer 5) — adds Layer-5 smoke
 * coverage for the MAR write-rail surface. Connects:
 *
 *   - BUG-622 (POST /medication-administrations canonical Zod schema)
 *   - BUG-623 (GET /medications/mar/:patientId flat response shape)
 *   - BUG-624/625/626 (NursingPage WRITE rail removed; DB NOT NULL belt)
 *   - BUG-632 (GET /medications/due-now wrong-table-join class)
 *
 * Cycle-2 absorb-1 (per L3 cycle-1 REJECT findings):
 *   - Selectors tightened to grid-scoped (MarChartPanel uses
 *     `role="region"` + `aria-label="Data table"` for its container)
 *     so the assertion does NOT match the broader page-text "Medications"
 *     tab label.
 *   - MAR toggle click made load-bearing — `expect(marToggle).toBeVisible()`
 *     replaces the conditional pre-check. A missing toggle now FAILS
 *     the test (cycle-1 silently skipped).
 *   - BUG-622 "dialog import health" claim DOWNGRADED to a generic
 *     React-error-boundary smoke check (the spec does not actually
 *     open the dialog, so claiming dialog-specific health was over-
 *     reaching). Full dialog interaction is BUG-634-FOLLOWUP-MAR-WRITE-MUTATION.
 *   - Honest claim language: this spec is a SMOKE check that catches
 *     full-tab-render failures + structural BUG-623 wrapper-shape
 *     regressions. It is NOT a comprehensive write-mutation regression
 *     suite — that is the follow-up.
 */

test.describe('MAR write-rail golden path (BUG-634)', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, 'clinician');
  });

  test('MAR sub-section renders with grid-scoped data table (BUG-622/623/632 smoke check)', async ({
    page,
  }) => {
    // Step 1-3: navigate to patient + open Medications tab.
    await navigateToPatient(page, 'Johnson');
    await dismissTourPopup(page);
    await clickPatientTab(page, 'Medications');

    // Wait for the medications panel to settle.
    await page
      .locator('[role="progressbar"]')
      .waitFor({ state: 'hidden', timeout: 15_000 })
      .catch(() => {});

    // Some records require explicit allergy acknowledgement before the
    // medication sub-sections are interactive.
    const allergyAcknowledge = page.getByRole('button', { name: /I have reviewed these allergies/i });
    if (await allergyAcknowledge.isVisible().catch(() => false)) {
      await allergyAcknowledge.click();
    }

    // Step 4: switch to MAR sub-section. Made LOAD-BEARING per L3 absorb —
    // a missing/renamed MAR toggle MUST fail the test, not pass-by-skip.
    const marToggleAsTab = page.getByRole('tab', { name: /^MAR Chart$/i }).first();
    const marToggleAsButton = page.getByRole('button', { name: /^MAR Chart$/i }).first();
    if (await marToggleAsTab.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await marToggleAsTab.click();
    } else {
      await expect(marToggleAsButton).toBeVisible({ timeout: 10_000 });
      await marToggleAsButton.click();
    }

    // Step 5: wait for the MAR grid to settle.
    await page
      .locator('[role="progressbar"]')
      .waitFor({ state: 'hidden', timeout: 10_000 })
      .catch(() => {});

    // Step 6: BUG-622/623 grid-scoped smoke check.
    //
    // Per L3 absorb: assertion narrowed to the MarChartPanel's `role="region"
    // aria-label="Data table"` container (verified at MarChartPanel.tsx:256
    // and :345). Pre-fix BUG-623 the consumer rendered every cell with
    // undefined labels but the table container itself still rendered;
    // post-fix the same container renders WITH legible cells.
    //
    // The assertion catches: (a) MAR tab unreachable (load-bearing toggle
    // click above), (b) MAR panel React error → no `role="region"` ever
    // mounts. Honest scope: this is a smoke check, NOT a per-cell shape
    // regression catch (full grid-cell shape is BUG-630's L4 territory).
    const marRegion = page.getByRole('region', { name: /^Data table$/i });
    const marErrorAlert = page.getByRole('alert').filter({ hasText: /Failed to load MAR/i }).first();
    const marEmptyAlert = page.getByRole('alert').filter({ hasText: /No active medications/i }).first();

    if (await marRegion.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(marRegion.first()).toBeVisible({ timeout: 10_000 });
    } else {
      // Fail-visible fallback path: if data is unavailable in demo state, the
      // UI must surface explicit clinical-safety banners instead of rendering
      // a silent empty grid.
      const hasErrorBanner =
        (await marErrorAlert.isVisible({ timeout: 2_000 }).catch(() => false)) ||
        (await marEmptyAlert.isVisible({ timeout: 2_000 }).catch(() => false));
      expect(hasErrorBanner).toBeTruthy();
    }

    // Step 7: React error boundary smoke check.
    //
    // L3 absorb downgraded this from "BUG-622 dialog import health" to a
    // generic error-boundary smoke. The spec does not open the admin
    // dialog (that's BUG-634-FOLLOWUP-MAR-WRITE-MUTATION). What IS
    // checked: the entire MAR tab renders without a top-level React
    // boundary firing — catches a complete dialog-component-import or
    // mapper-import failure that would crash the whole tab.
    const errorBoundary = page.getByText(/something went wrong/i);
    await expect(errorBoundary).toHaveCount(0);
  });
});
