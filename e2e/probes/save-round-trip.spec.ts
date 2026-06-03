/**
 * Probe II.C.2 — save-round-trip
 *
 * On representative save/submit surfaces, fill the form with plausible
 * data → click Save → wait for response → reload the page → assert
 * the saved values persist.
 *
 * Catches: Bug 3/4/5/6 class (save returns 200 but the data doesn't
 * persist; UI looks successful; clinician discovers on reload).
 *
 * This probe targets a curated SAVE_SURFACES list rather than a
 * fully generic "find every button called Save" walker — reason:
 * a truly generic walker is flakier than it's worth against MUI
 * (Autocomplete, DatePicker, conditional fields), and the high-
 * value surfaces are well-known. Expand this list as new save
 * flows ship.
 *
 * Run: `npx playwright test e2e/probes/save-round-trip.spec.ts`
 */
import { test, expect, useAs } from '../fixtures/auth';

// BUG-032 — restore superadmin storageState; see route-crawler.spec.ts rationale.
test.use(useAs('superadmin'));

test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

async function openTasksSurface(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  const addBtn = page.getByRole('button', { name: /new task|create task|add task/i }).first();
  await expect(addBtn).toBeVisible({ timeout: 20_000 });
}

interface SaveSurface {
  name: string;
  // Navigate to the form. Admin-authed page is passed in.
  open: (page: import('@playwright/test').Page) => Promise<void>;
  // Fill the form with a unique marker (returned so we can assert later).
  fill: (page: import('@playwright/test').Page, marker: string) => Promise<void>;
  // Submit + wait.
  submit: (page: import('@playwright/test').Page) => Promise<void>;
  // Re-open the same record in edit mode.
  reopen: (page: import('@playwright/test').Page) => Promise<void>;
  // Assert the marker persists.
  assertPersisted: (page: import('@playwright/test').Page, marker: string) => Promise<void>;
}

// High-value save surfaces — curated. Each surface catches the
// Bug 3/4/5/6 class for its specific feature.
const SURFACES: SaveSurface[] = [
  {
    name: 'task-create',
    async open(page) {
      await openTasksSurface(page);
      const addBtn = page.getByRole('button', { name: /new task|create task|add task/i }).first();
      await expect(addBtn).toBeVisible({ timeout: 20_000 });
      await addBtn.click();
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    },
    async fill(page, marker) {
      const dialog = page.getByRole('dialog');
      const titleInput = dialog.getByLabel(/task title/i).first();
      await expect(titleInput).toBeVisible({ timeout: 5_000 });
      await titleInput.fill(`AutoProbe-${marker}`);
    },
    async submit(page) {
      const dialog = page.getByRole('dialog');
      const saveBtn = dialog.getByRole('button', { name: /create task|save changes|save|create|add/i }).first();
      await expect(saveBtn).toBeVisible({ timeout: 5_000 });
      await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
      const createResp = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/api/v1/tasks') && r.request().method() === 'POST',
          { timeout: 10_000 },
        ),
        saveBtn.click(),
      ]).then(([resp]) => resp);
      expect(createResp.status(), `task create should not fail (${createResp.url()})`).toBeLessThan(400);
      await expect(dialog).toBeHidden({ timeout: 10_000 });
    },
    async reopen(page) {
      await page.reload();
      await page.waitForTimeout(2000);
      const teamTab = page.getByRole('tab', { name: /team tasks/i }).first();
      if (await teamTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await teamTab.click();
      }
    },
    async assertPersisted(page, marker) {
      await expect(page.getByText(`AutoProbe-${marker}`).first()).toBeVisible({ timeout: 10_000 });
    },
  },
  {
    name: 'subscription-create',
    async open(page) {
      await page.goto('/subscription');
      await expect(page.getByRole('heading', { name: /subscription management/i }).first()).toBeVisible({ timeout: 10_000 });
      const createBtn = page.getByRole('button', { name: /new subscription/i }).first();
      await expect(createBtn).toBeVisible({ timeout: 10_000 });
      await createBtn.click();
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    },
    async fill(page, marker) {
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(/clinic.*organisation/i).fill(`AutoProbeOrg-${marker}`);
      await dialog.getByLabel(/contact name/i).fill(`Owner ${marker}`);
      await dialog.getByLabel(/^email/i).fill(`autoprobe-${marker}@signacare.local`);
    },
    async submit(page) {
      const dialog = page.getByRole('dialog');
      const createBtn = dialog.getByRole('button', { name: /create subscription/i }).first();
      await expect(createBtn).toBeVisible({ timeout: 5_000 });
      await expect(createBtn).toBeEnabled({ timeout: 5_000 });
      await createBtn.click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });
    },
    async reopen(page) {
      await page.reload();
      await page.waitForTimeout(1500);
    },
    async assertPersisted(page, marker) {
      await expect(page.getByText(`AutoProbeOrg-${marker}`).first()).toBeVisible({ timeout: 10_000 });
    },
  },
];

test.describe('Probe: save-round-trip (as superadmin)', () => {

  for (const surface of SURFACES) {
    test(`${surface.name} — fill + save + reload + persists`, async ({ page }) => {
      const marker = Date.now().toString(36).slice(-6);
      await surface.open(page);
      await surface.fill(page, marker);
      await surface.submit(page);
      await surface.reopen(page);
      await surface.assertPersisted(page, marker);
    });
  }
});
