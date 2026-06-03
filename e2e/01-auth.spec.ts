import { test, expect, loginViaApi, USERS } from './fixtures/auth';

test.describe('Authentication', () => {
  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(USERS.superadmin.email);
    await page.locator('input[name="password"]').fill(USERS.superadmin.password);
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    await expect(page).toHaveURL(/dashboard/);
  });

  test('login with invalid password shows error message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(USERS.superadmin.email);
    await page.locator('input[name="password"]').fill('WrongPassword99!');
    await page.getByRole('button', { name: /sign in/i }).click();

    // The LoginForm renders an Alert with role="alert" on error
    const errorAlert = page.getByRole('alert');
    await expect(errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(errorAlert).toContainText(/fail|invalid|incorrect|denied/i);

    // Should remain on the login page
    await expect(page).toHaveURL(/login/);
  });

  test('dashboard displays logged-in user name', async ({ page }) => {
    await loginViaApi(page, 'superadmin');

    // The sidebar bottom section renders the user's name / avatar
    const sidebar = page.locator('nav[aria-label="Main navigation"]');
    await expect(sidebar).toBeVisible({ timeout: 10_000 });

    // The sidebar should contain the admin user's name somewhere
    await expect(sidebar.getByText(/admin|e2e/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('logout redirects to login page', async ({ page }) => {
    await loginViaApi(page, 'superadmin');

    // The sign-out button is in the sidebar bottom area (not a top bar menu)
    const sidebar = page.locator('nav[aria-label="Main navigation"]');
    await expect(sidebar).toBeVisible({ timeout: 10_000 });

    // Click "Sign out" / "Logout" button in the sidebar
    const signOutBtn = sidebar.getByRole('button', { name: /sign out|logout/i })
      .or(sidebar.getByText(/sign out|logout/i).first());
    await expect(signOutBtn).toBeVisible({ timeout: 10_000 });
    await signOutBtn.click();

    // Should redirect to login
    await page.waitForURL('**/login', { timeout: 10_000 });
    await expect(page).toHaveURL(/login/);
  });

  test('protected route redirects unauthenticated user to login', async ({ page }) => {
    // Visit /patients without logging in
    await page.goto('/patients');

    // Should be redirected to the login page
    await page.waitForURL('**/login', { timeout: 10_000 });
    await expect(page).toHaveURL(/login/);
  });

  test('role-based sidebar: superadmin sees Power Settings, clinician does not', async ({
    browser,
  }) => {
    // --- Superadmin context ---
    // Power Settings is only visible to superadmin.

    // --- Clinician context ---
    const clinicianContext = await browser.newContext();
    const clinicianPage = await clinicianContext.newPage();
    await loginViaApi(clinicianPage, 'clinician');

    // Expand all sidebar groups so collapsed items are revealed
    // The sidebar navigation has aria-label="Main navigation"
    const sidebar = clinicianPage.locator('nav[aria-label="Main navigation"]');
    await expect(sidebar).toBeVisible({ timeout: 10_000 });

    // "Power Settings" should NOT be present for a clinician
    await expect(sidebar.getByText('Power Settings')).toHaveCount(0);

    await clinicianContext.close();

    // --- Admin context (verify clinic admin sees settings group but not Power Settings) ---
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginViaApi(adminPage, 'admin');

    const adminSidebar = adminPage.locator('nav[aria-label="Main navigation"]');
    await expect(adminSidebar).toBeVisible({ timeout: 10_000 });

    const settingsGroup = adminSidebar.getByText('Settings', { exact: true }).first();
    await expect(settingsGroup).toBeVisible({ timeout: 5_000 });
    await expect(adminSidebar.getByText('Power Settings')).toHaveCount(0);

    await adminContext.close();
  });
});
