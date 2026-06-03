/**
 * Probe II.C.5 — double-submit
 *
 * On a curated set of save flows, click Save twice within 100ms.
 * Asserts exactly ONE record created (via GET list after). A flow
 * that creates 2 records = a double-submit bug (common in React
 * when the Save button's disabled state has a render race).
 *
 * Catches: duplicate-record bugs (common in prescribing, task
 * create, appointment book, alert create).
 *
 * Scope: 3 high-risk flows. Expand as needed.
 *
 * Run: `npx playwright test e2e/probes/double-submit.spec.ts`
 */
import { test, expect, ensureMainNavigationClosed, useAs } from '../fixtures/auth';

// BUG-032 — restore superadmin storageState; see route-crawler.spec.ts rationale.
test.use(useAs('superadmin'));

test.describe.configure({ mode: 'serial' });

test.describe('Probe: double-submit (as superadmin)', () => {
  test.setTimeout(60_000);
  test.slow();

  async function openTasksSurface(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    await ensureMainNavigationClosed(page);
    const newTaskButton = page.getByRole('button', { name: /new task|create task|add task/i }).first();
    await expect(newTaskButton).toBeVisible({ timeout: 20_000 });
  }

  test('task create — double-click produces one task', async ({ page, request }) => {
    const marker = `DblSubmit-${Date.now().toString(36)}`;
    await openTasksSurface(page);

    const addBtn = page.getByRole('button', { name: /new task|create task|add task/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    const titleInput = dialog.getByLabel(/task title/i).first();
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill(marker);

    const saveBtn = dialog.getByRole('button', { name: /create task|save changes|save|create|add/i }).first();
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });

    const createResponse = page.waitForResponse(
      (r) => r.url().includes('/api/v1/tasks') && r.request().method() === 'POST',
      { timeout: 10_000 },
    ).catch(() => null);

    // Double-click within 100ms
    await Promise.all([
      saveBtn.click(),
      saveBtn.click({ delay: 50 }).catch(() => null),
    ]);
    const createResp = await createResponse;
    expect(createResp, 'task create request did not fire').not.toBeNull();
    if (createResp) {
      expect(createResp.status(), `task create failed: ${createResp.url()}`).toBeLessThan(400);
    }
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await page.waitForTimeout(1500);

    // Count via API
    const resp = await request.get('/api/v1/tasks');
    const body = resp.ok() ? await resp.json() : { tasks: [] };
    const tasks: Array<{ title?: string; description?: string }> = body.tasks || body.data || (Array.isArray(body) ? body : []);
    const matches = tasks.filter((t) =>
      (t.title && t.title.includes(marker)) ||
      (t.description && t.description.includes(marker)),
    );
    expect(
      matches.length,
      `double-click created ${matches.length} task(s) with marker ${marker}; expected exactly 1`,
    ).toBe(1);
  });
});
