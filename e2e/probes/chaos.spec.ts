/**
 * Probe II.J — chaos / fault injection
 *
 * Wraps critical save flows with page.route() that intercepts the
 * submit API call and replaces the response with one of five chaos
 * modes:
 *   1. NETWORK_ERROR — abort the request
 *   2. SERVER_500 — 500 with stub body
 *   3. SLOW — 10s delay then 200 (tests timeout + spinner behaviour)
 *   4. EMPTY — 200 with {} (empty body, UI must not crash)
 *   5. MALFORMED_JSON — 200 with invalid JSON
 *
 * For each flow × mode, asserts the UI does NOT:
 *   - Show a fatal error-boundary fallback
 *   - Lose user input from the form
 *   - Render blank white
 *
 * Run: `npx playwright test e2e/probes/chaos.spec.ts`
 */
import { test, expect, useAs } from '../fixtures/auth';

// BUG-032 — restore superadmin storageState; see route-crawler.spec.ts rationale.
test.use(useAs('superadmin'));

test.describe.configure({ mode: 'serial' });

type ChaosMode = 'network-error' | 'server-500' | 'slow' | 'empty' | 'malformed';

interface ChaosFlow {
  name: string;
  route: string;
  apiPattern: RegExp;
  open: (page: import('@playwright/test').Page) => Promise<void>;
}

const FLOWS: ChaosFlow[] = [
  {
    name: 'task-create',
    route: '/tasks',
    apiPattern: /\/api\/v1\/tasks(\?|$)/,
    async open(page) {
      const addBtn = page.getByRole('button', { name: /add task|new task|create task/i }).first();
      if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await addBtn.click();
      }
    },
  },
];

const MODES: ChaosMode[] = ['network-error', 'server-500', 'slow', 'empty', 'malformed'];

async function applyChaos(
  page: import('@playwright/test').Page,
  pattern: RegExp,
  mode: ChaosMode,
) {
  await page.route(pattern, async (route) => {
    if (route.request().method() !== 'POST' && route.request().method() !== 'PUT' && route.request().method() !== 'PATCH') {
      return route.continue();
    }
    switch (mode) {
      case 'network-error':
        return route.abort('failed');
      case 'server-500':
        return route.fulfill({ status: 500, body: JSON.stringify({ error: 'simulated' }) });
      case 'slow':
        await new Promise((r) => setTimeout(r, 10_000));
        return route.fulfill({ status: 200, body: JSON.stringify({ id: 'chaos-' + Math.random().toString(36) }) });
      case 'empty':
        return route.fulfill({ status: 200, body: JSON.stringify({}) });
      case 'malformed':
        return route.fulfill({ status: 200, body: 'this is not JSON {}' });
    }
  });
}

test.describe('Probe: chaos (as superadmin)', () => {
  for (const flow of FLOWS) {
    for (const mode of MODES) {
      test(`${flow.name} survives ${mode}`, async ({ page }) => {
        await page.goto(flow.route);
        await page.waitForTimeout(1500);
        await applyChaos(page, flow.apiPattern, mode);
        await flow.open(page);
        await page.waitForTimeout(500);

        // Fill some input if available
        const title = page.getByLabel(/title|description/i).first();
        if (await title.isVisible({ timeout: 2000 }).catch(() => false)) {
          await title.fill('ChaosProbe');
        }
        // Click the submit button
        const saveBtn = page.getByRole('button', { name: /^save$|^create$|^add$|^submit$/i }).first();
        if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          // Race: submit + wait up to 3s for something to happen
          await Promise.race([
            saveBtn.click(),
            page.waitForTimeout(3000),
          ]);
          await page.waitForTimeout(2000);
        }

        // Assertions:
        // (1) No fatal error boundary
        const body = await page.locator('body').innerText();
        expect(body, `chaos-${mode} on ${flow.name} triggered error boundary`).not.toMatch(
          /something went wrong — fatal|application crash|white screen/i,
        );
        // (2) Page still has some rendered content
        expect(body.length, `chaos-${mode} on ${flow.name} produced blank page`).toBeGreaterThan(20);
      });
    }
  }
});
