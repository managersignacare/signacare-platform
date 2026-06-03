/**
 * Category 3 — Page Object Model: Episodes tab inside the patient detail.
 *
 * Models the "Episodes of Care" panel — list, add-episode dialog,
 * and the canonical create flow that the existing 03-episodes spec
 * exercises with inline selectors. Centralising this here means a
 * future spec only writes 3 lines:
 *
 *   const ep = await detail.openEpisodesTab();
 *   await ep.expectLoaded();
 *   await ep.createEpisode({ title: 'Acute', episodeType: 'community' });
 *
 * The class wraps the MUI Dialog + Select interaction quirk that
 * existing specs all repeat (you must select the type FIRST or the
 * title gets auto-overwritten).
 */

import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export interface CreateEpisodeOptions {
  title: string;
  episodeType: 'community' | 'inpatient' | 'outpatient' | 'consult';
  presentingProblem?: string;
}

export class EpisodePage {
  readonly page: Page;
  readonly patientId: string;
  readonly heading: Locator;
  readonly addEpisodeButton: Locator;
  readonly episodeCards: Locator;

  constructor(page: Page, patientId: string) {
    this.page = page;
    this.patientId = patientId;
    this.heading = page.getByText('Episodes of Care');
    this.addEpisodeButton = page.getByRole('button', { name: /add episode/i });
    this.episodeCards = page.locator('.MuiCard-root');
  }

  /** Wait for the Episodes panel to render. */
  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: 10_000 });
    await expect(this.addEpisodeButton).toBeVisible();
  }

  /**
   * Returns true if there is at least one episode card visible, false
   * if the empty-state alert is showing. Throws if neither.
   */
  async hasEpisodes(): Promise<boolean> {
    const hasCards = await this.episodeCards.first().isVisible().catch(() => false);
    if (hasCards) return true;
    const empty = await this.page.getByText(/no active episodes/i).isVisible().catch(() => false);
    if (empty) return false;
    throw new Error('Episodes tab is in an unexpected state — neither cards nor empty alert visible');
  }

  /**
   * Open the Add Episode dialog, fill the canonical fields, submit,
   * and wait for the dialog to close. Implements the
   * "type-first then title" ordering quirk.
   */
  async createEpisode(opts: CreateEpisodeOptions): Promise<void> {
    await this.addEpisodeButton.click();

    const dialog = this.page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toContainText(/add episode/i);

    // 1. Episode type — MUST come first because type-change auto-rewrites
    //    the title field.
    const typeSelect = dialog.getByLabel(/episode type/i);
    await typeSelect.click();
    const opt = this.page.getByRole('option', { name: new RegExp(opts.episodeType, 'i') });
    await expect(opt).toBeVisible({ timeout: 5_000 });
    await opt.click();
    await this.page.waitForTimeout(300); // dropdown close animation

    // 2. Title (clear the auto-generated value first)
    const titleInput = dialog.getByLabel(/episode name/i);
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.clear();
    await titleInput.fill(opts.title);

    // 3. Presenting problem (optional)
    if (opts.presentingProblem) {
      const probInput = dialog.getByLabel(/presenting problem/i);
      if (await probInput.isVisible().catch(() => false)) {
        await probInput.fill(opts.presentingProblem);
      }
    }

    // 4. Submit
    const submit = dialog.getByRole('button', { name: /create episode|add episode|create|add|save/i }).first();
    await expect(submit).toBeEnabled({ timeout: 5_000 });
    await submit.click();

    // 5. Wait for the dialog to close (success path)
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }
}
