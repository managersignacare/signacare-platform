/**
 * Category 3 — Page Object Model: Patient detail screen.
 *
 * The patient detail page is a tabbed shell — Demographics, Episodes,
 * Notes, Medications, Referrals, etc. each render in their own tab
 * panel. This POM exposes:
 *   - patientId (parsed from the current URL)
 *   - clickTab(tabName) — works with any tab regardless of label
 *   - typed accessors for the most common downstream pages (returns
 *     a fresh EpisodePage when the Episodes tab is opened)
 *
 * Selectors are role-based (`role="tab"`) which matches the existing
 * spec convention.
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { EpisodePage } from './EpisodePage';
import { clickPatientTab } from '../fixtures/auth';

export class PatientDetailPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Extract the patient UUID from the current URL. Returns the
   * empty string if the URL doesn't match — caller can fail loudly.
   */
  get patientId(): string {
    const match = this.page.url().match(/patients\/([a-f0-9-]+)/);
    return match?.[1] ?? '';
  }

  /**
   * Click a tab by visible name (case-insensitive substring).
   * Resolves only after the tab is visible AND clicked, so callers
   * don't need their own waits.
   */
  async clickTab(tabName: string): Promise<void> {
    const tab = this.page.getByRole('tab', { name: new RegExp(tabName, 'i') });
    if (await tab.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
      await tab.first().click();
      await this.page.waitForTimeout(500);
      return;
    }

    // Newer patient-detail layouts may expose tabs via side-nav actions
    // rather than top tablist controls. Reuse the shared resilient helper.
    await clickPatientTab(this.page, tabName);
  }

  /** Open the Episodes tab and return a typed EpisodePage. */
  async openEpisodesTab(): Promise<EpisodePage> {
    await this.clickTab('Episodes');
    return new EpisodePage(this.page, this.patientId);
  }

  /** Open the Notes tab. Returns this for fluent chaining. */
  async openNotesTab(): Promise<this> {
    await this.clickTab('Notes');
    return this;
  }

  /** Open the Medications tab. */
  async openMedicationsTab(): Promise<this> {
    await this.clickTab('Medications');
    return this;
  }

  /** Open the Referrals tab. */
  async openReferralsTab(): Promise<this> {
    await this.clickTab('Referrals');
    return this;
  }

  /**
   * Assert the patient detail shell has loaded. Looks for any tab
   * (the tablist is the most reliable signal that the detail page
   * has finished mounting).
   */
  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('tablist').first()).toBeVisible({
      timeout: 10_000,
    });
  }
}
