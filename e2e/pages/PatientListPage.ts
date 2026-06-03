/**
 * Category 3 — Page Object Model: Patient list / search.
 *
 * Wraps the search-and-open-patient interaction that nearly every
 * workflow spec needs. Mirrors fixtures/auth.ts:navigateToPatient
 * but as a class so a workflow spec can hold a single instance and
 * get back a strongly-typed PatientDetailPage on open().
 */

import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { PatientDetailPage } from './PatientDetailPage';
import { dismissTourPopup } from '../fixtures/auth';

export class PatientListPage {
  readonly page: Page;
  readonly searchInput: Locator;
  readonly resultsTable: Locator;

  constructor(page: Page) {
    this.page = page;
    // Single canonical search input — the placeholder match handles
    // both the inline search and the dialog search variants.
    this.searchInput = page.getByPlaceholder(/search by name/i).first();
    this.resultsTable = page.locator('table tbody');
  }

  /** Navigate to /patients and wait for the table to render. */
  async goto(): Promise<void> {
    await this.page.goto('/patients');
    await expect(this.searchInput).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Type into the search box and wait for the debounced API call to
   * settle. The web app uses a 500ms debounce + a network round-trip,
   * so we wait 1500ms (matches fixtures/auth.ts).
   */
  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
    await this.page.waitForTimeout(1500);
  }

  /**
   * Open the first matching patient row and return a typed
   * PatientDetailPage. Throws via expect() if no row materialises.
   */
  async openFirstResult(): Promise<PatientDetailPage> {
    const firstRow = this.resultsTable.locator('tr').first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
    const noPatients = firstRow.getByText(/no patients found/i);
    if (await noPatients.isVisible().catch(() => false)) {
      throw new Error('PatientListPage.openFirstResult found only the "No patients found" row.');
    }

    await Promise.all([
      this.page.waitForURL(/\/patients\/[a-f0-9-]+(?:\?.*)?$/i, { timeout: 12_000 }),
      firstRow.locator('td').first().click(),
    ]);

    // Wait for the detail page shell to mount, then dismiss the
    // guided-tour popup that can overlay the tabs.
    await this.page.waitForTimeout(1000);
    await dismissTourPopup(this.page);

    return new PatientDetailPage(this.page);
  }

  /**
   * Convenience: search + open in one call.
   */
  async findAndOpen(searchName: string): Promise<PatientDetailPage> {
    await this.goto();
    await this.search(searchName);
    return this.openFirstResult();
  }

  /**
   * Returns the visible row count after a search. Useful for assertions
   * like "soft-deleted patients no longer appear".
   */
  async visibleRowCount(): Promise<number> {
    return this.resultsTable.locator('tr').count();
  }
}
