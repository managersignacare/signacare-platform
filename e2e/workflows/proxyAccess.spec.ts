/**
 * Workflow — Guardian / Proxy Access.
 *
 * Full clinical journey:
 *   1. Clinician logs in, opens a patient record
 *   2. Issues scoped proxy access to a family member (email,
 *      relationship, scope flags, expiry in days)
 *   3. System generates a redemption URL
 *   4. Grantee opens the URL in a fresh browser context (isolated
 *      storageState) → lands on a scoped patient-view screen
 *   5. Grantee sees ONLY the fields in the scope flags
 *      (demographics + appointments; NOT notes / medications)
 *   6. Time-travels to after the expiry date — access is auto-revoked
 *   7. Grantee hitting the redemption URL again after expiry → 403
 *
 * KNOWN GAP: the proxy-access feature does NOT exist in the Signacare
 * codebase today. The whole spec is marked test.fixme() so it
 * shows in Playwright's output as "fixed (pending)" — a reminder
 * that the acceptance criteria are defined but the feature is
 * outstanding. When the feature lands, remove the fixme markers.
 *
 * Standard satisfied (when implemented): Australian Privacy Act
 *                     1988 APP 6 (use/disclosure — scoped consent),
 *                     My Health Record Act 2012 §75, ACHS Standard 2
 *                     (Partnering with consumers — proxy access is
 *                     the mandated family-inclusion control).
 */

import { test, expect } from '../fixtures/auth';
import { LoginPage } from '../pages';
import { ProxyAccessPage } from '../pages/ProxyAccessPage';

const RUN_ID = Date.now().toString(36).slice(-5);

test.describe.serial('Workflow — Guardian / Proxy Access', () => {
  test.fixme(true, 'Proxy access feature not yet implemented — see ProxyAccessPage POM for acceptance criteria');

  test('clinician issues scoped proxy access to a family member', async ({ page }) => {
    const login = new LoginPage(page);
    await login.loginAs('clinician');

    const proxy = await ProxyAccessPage.openForPatient(page, 'Johnson');
    await proxy.expectLoaded();

    const { redemptionUrl } = await proxy.issueProxyAccess({
      granteeEmail: `proxy-${RUN_ID}@example.com`,
      granteeFullName: `Proxy Grantee ${RUN_ID}`,
      relationship: 'parent',
      scope: ['demographics', 'appointments'],
      expiresInDays: 30,
    });

    expect(redemptionUrl).toContain('/proxy/');
    const emails = await proxy.activeGrantEmails();
    expect(emails).toContain(`proxy-${RUN_ID}@example.com`);
  });

  test('grantee sees ONLY the fields in the scope flags', async ({ browser }) => {
    // Fresh browser context so the grantee has no clinician session
    const context = await browser.newContext();
    const granteePage = await context.newPage();
    // The redemption URL would come from the test above in a
    // serial chain — in this skeleton we reference a placeholder.
    await granteePage.goto('https://example.test/proxy/REDEMPTION_TOKEN');

    // Grantee MUST see demographics + appointments
    await expect(granteePage.getByRole('heading', { name: /patient details/i })).toBeVisible();
    await expect(granteePage.getByRole('heading', { name: /upcoming appointments/i })).toBeVisible();

    // Grantee MUST NOT see clinical notes or medications
    await expect(granteePage.getByRole('heading', { name: /clinical notes/i })).toBeHidden();
    await expect(granteePage.getByRole('heading', { name: /medications/i })).toBeHidden();

    await context.close();
  });

  test('access is automatically revoked after the expiration date', async ({ browser }) => {
    // Time-travel: the test environment supports setting the
    // server clock forward via an admin endpoint. Alternatively
    // the test seeds a grant with an already-past expires_at.
    const context = await browser.newContext();
    const granteePage = await context.newPage();
    await granteePage.goto('https://example.test/proxy/EXPIRED_TOKEN');

    // Expect a 403 / "access expired" page, NOT the patient view
    await expect(
      granteePage.getByText(/access has expired|no longer valid|revoked/i),
    ).toBeVisible();

    await context.close();
  });

  test('clinician can manually revoke a grant and it becomes inactive immediately', async ({ page }) => {
    const login = new LoginPage(page);
    await login.loginAs('clinician');
    const proxy = await ProxyAccessPage.openForPatient(page, 'Johnson');

    await proxy.revokeGrantForEmail(`proxy-${RUN_ID}@example.com`);
    const emails = await proxy.activeGrantEmails();
    expect(emails).not.toContain(`proxy-${RUN_ID}@example.com`);
  });
});
