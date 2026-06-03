/**
 * Category 3 — Page Object Model: Login screen.
 *
 * Wraps the existing inline-selector pattern from e2e/fixtures/auth.ts
 * (loginAs) into a class with explicit responsibilities, so workflow
 * specs can call `await new LoginPage(page).loginAs('admin')` instead
 * of repeating selector strings. The class is intentionally thin —
 * the credentials live in the existing USERS map and the dashboard
 * URL wait stays the same.
 *
 * The web app currently has zero data-testid attributes (audited in
 * the Category 3 survey). Selectors here are role/label/name based
 * — the same convention every existing spec uses.
 */

import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { USERS } from '../fixtures/auth';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorAlert: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel(/email/i);
    this.passwordInput = page.locator('input[name="password"]');
    this.submitButton = page.getByRole('button', { name: /sign in/i });
    this.errorAlert = page.getByRole('alert');
  }

  /** Navigate to the login route and wait for the form to render. */
  async goto(): Promise<void> {
    await this.page.goto('/login');
    // Pre-emptively dismiss the guided tour overlay before login
    // completes — same trick as fixtures/auth.ts.
    await this.page.evaluate(() =>
      sessionStorage.setItem('tour-dismissed', 'true'),
    );
    await expect(this.emailInput).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Fill the form, submit, and wait for the post-login redirect to
   * the dashboard. Throws if the dashboard URL never settles.
   */
  async loginAs(userKey: keyof typeof USERS): Promise<void> {
    const user = USERS[userKey];
    await this.goto();
    await this.emailInput.fill(user.email);
    await this.passwordInput.fill(user.password);
    await this.submitButton.click();
    await this.page.waitForURL('**/dashboard', { timeout: 15_000 });
  }

  /**
   * Submit a login attempt and assert the form is rejected with an
   * inline error. Used by negative auth tests — does NOT redirect.
   */
  async loginExpectingFailure(email: string, password: string): Promise<void> {
    await this.goto();
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
    await expect(this.errorAlert).toBeVisible({ timeout: 5_000 });
  }
}
