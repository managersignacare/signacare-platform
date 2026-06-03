/**
 * Page Object Model: Guardian / Proxy Access admin screen.
 *
 * KNOWN GAP: the proxy-access feature does NOT exist in the Signacare
 * codebase today (survey confirmed no `patient_proxy_access` table,
 * no `features/proxy/` module). This POM is the acceptance-criterion
 * skeleton for the eventual implementation:
 *
 *   1. An admin UI at /patients/:id/proxy-access for a clinician
 *      to issue scoped access to a family member / legal guardian
 *   2. A `patient_proxy_grant` row with: grantor_staff_id,
 *      grantee_email, scope, granted_at, expires_at, revoked_at
 *   3. A scoped view the grantee sees after redeeming the token
 *   4. Automatic revocation past expires_at
 *
 * The companion spec (proxyAccess.spec.ts) uses test.fixme() to
 * skip the whole flow today. When the feature lands, remove the
 * fixme markers and the spec becomes an end-to-end regression.
 */

import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { PatientListPage } from './PatientListPage';

export interface IssueProxyAccessOptions {
  granteeEmail: string;
  granteeFullName: string;
  relationship: 'parent' | 'guardian' | 'spouse' | 'carer' | 'legal_representative';
  scope: Array<'demographics' | 'appointments' | 'medications' | 'notes'>;
  expiresInDays: number;
}

export class ProxyAccessPage {
  readonly page: Page;
  readonly addButton: Locator;
  readonly grantList: Locator;

  constructor(page: Page) {
    this.page = page;
    this.addButton = page.getByRole('button', { name: /grant proxy access/i });
    this.grantList = page.getByRole('table', { name: /proxy access grants/i });
  }

  /**
   * Navigate to the proxy-access screen for a given patient. Expects
   * the caller to have already opened the patient detail shell.
   */
  static async openForPatient(page: Page, searchName: string): Promise<ProxyAccessPage> {
    const list = new PatientListPage(page);
    const detail = await list.findAndOpen(searchName);
    await detail.expectLoaded();
    // Proxy access is expected to live as a tab on the patient detail
    await detail.clickTab('Proxy Access');
    return new ProxyAccessPage(page);
  }

  /** Wait for the proxy-access panel to mount. */
  async expectLoaded(): Promise<void> {
    await expect(this.addButton).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Open the grant dialog and issue a new proxy access. The test
   * captures the generated redemption URL from the confirmation
   * dialog for use in a second browser context.
   */
  async issueProxyAccess(opts: IssueProxyAccessOptions): Promise<{ redemptionUrl: string }> {
    await this.addButton.click();
    const dialog = this.page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.getByLabel(/grantee email/i).fill(opts.granteeEmail);
    await dialog.getByLabel(/grantee name/i).fill(opts.granteeFullName);

    const rel = dialog.getByLabel(/relationship/i);
    await rel.click();
    await this.page.getByRole('option', { name: new RegExp(opts.relationship, 'i') }).click();

    // Multi-select checkboxes for scope
    for (const tag of opts.scope) {
      await dialog.getByLabel(new RegExp(tag, 'i')).check();
    }

    // Expiry days — a numeric input
    await dialog.getByLabel(/expires in/i).fill(String(opts.expiresInDays));

    await dialog.getByRole('button', { name: /^(grant|issue)$/i }).click();

    // Confirmation dialog renders the redemption URL in a code block
    const confirm = this.page.getByRole('dialog', { name: /access granted|redemption/i });
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    const url = await confirm.getByTestId('redemption-url').innerText();
    expect(url).toMatch(/^https?:\/\//);
    return { redemptionUrl: url };
  }

  /** Revoke a previously issued grant by grantee email. */
  async revokeGrantForEmail(email: string): Promise<void> {
    const row = this.grantList.locator('tr', { hasText: email });
    await row.getByRole('button', { name: /revoke/i }).click();
    // Confirmation dialog
    const confirm = this.page.getByRole('dialog', { name: /confirm revocation/i });
    await confirm.getByRole('button', { name: /revoke/i }).click();
    await expect(confirm).toBeHidden({ timeout: 5_000 });
  }

  /** List the emails of all currently active grants. */
  async activeGrantEmails(): Promise<string[]> {
    const rows = await this.grantList.locator('tbody tr').all();
    const emails: string[] = [];
    for (const r of rows) {
      const statusCell = await r.getByTestId('grant-status').innerText().catch(() => '');
      if (statusCell.toLowerCase().includes('active')) {
        const email = await r.getByTestId('grant-email').innerText().catch(() => '');
        if (email) emails.push(email);
      }
    }
    return emails;
  }
}
