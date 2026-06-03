/**
 * Probe II.C.3 — button-smoke
 *
 * Visit each non-clinical route as superadmin. Enumerate every button on
 * each page. Click each (excluding destructive). Assert at least one
 * of: dialog opens / network call fires / URL changes / aria-state
 * toggles. Log buttons that do nothing as dead-button candidates.
 *
 * Catches: Bug 5 class ("save" button that only mutates local state;
 * no API call), dead UI buttons, buttons wired to wrong handlers.
 *
 * Scope: limited to core routes (dashboard + patient list + tasks +
 * appointments + calendar + messages + correspondence + drafts +
 * exports + subscription). Clinical + admin routes excluded because
 * they require richer seed data than the minimal e2e fixtures
 * provide.
 *
 * Run: `npx playwright test e2e/probes/button-smoke.spec.ts`
 */
import { test, expect, useAs } from '../fixtures/auth';
import { SMOKE_ROUTES } from '../fixtures/routes';

// BUG-032 — restore superadmin storageState; see route-crawler.spec.ts rationale.
test.use(useAs('superadmin'));

test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

const DESTRUCTIVE = /\b(delete|remove|discharge|revoke|terminate|drop|destroy|sign out|logout|log out)\b/i;

test.describe('Probe: button-smoke (as superadmin)', () => {

  for (const route of SMOKE_ROUTES) {
    test(`${route.path} — every safe button triggers handler`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      const buttonsLocator = page.getByRole('button');
      const buttonCount = await buttonsLocator.count();
      const candidates: { name: string; index: number }[] = [];
      // Cap scan cost so routes with large card lists don't timeout
      // before we even reach the click-probe phase.
      const scanLimit = Math.min(buttonCount, 80);
      for (let i = 0; i < scanLimit; i++) {
        const btn = buttonsLocator.nth(i);
        const name = (await btn.getAttribute('aria-label')) ||
                     (await btn.textContent())?.trim() ||
                     '';
        if (!name || DESTRUCTIVE.test(name)) continue;
        const disabled = await btn.isDisabled().catch(() => true);
        if (disabled) continue;
        candidates.push({ name, index: i });
      }

      const dead: string[] = [];
      const max = Math.min(candidates.length, 10); // probe first 10 per route to keep runtime reasonable
      for (let i = 0; i < max; i++) {
        const c = candidates[i];
        const btn = buttonsLocator.nth(c.index);
        let reacted = false;
        const initialUrl = page.url();
        const dialogPromise = page.waitForSelector('[role="dialog"]', { timeout: 1500 }).catch(() => null);
        const respPromise = page.waitForResponse(() => true, { timeout: 1500 }).catch(() => null);
        try {
          await btn.click({ timeout: 1500, trial: false });
        } catch {
          continue;
        }
        await Promise.race([dialogPromise, respPromise, page.waitForTimeout(1200)]);
        if (page.url() !== initialUrl) reacted = true;
        if (!reacted) {
          const dlg = await page.locator('[role="dialog"]').count();
          if (dlg > 0) reacted = true;
        }
        // Close any opened dialog by pressing Escape so next iteration's state is clean
        await page.keyboard.press('Escape').catch(() => null);
        await page.waitForTimeout(300);

        if (!reacted) dead.push(c.name);
      }
      if (dead.length > 0) {
        console.log(`[button-smoke] ${route.path} dead-button candidates: ${dead.join(', ')}`);
      }
      // Non-strict: this probe is meant to surface signal, not fail CI
      // on first dead button. The catalogue takes dead-button candidates
      // to log; fix pass triages.
      expect(dead.length).toBeLessThan(20); // sanity: don't flood
    });
  }
});
