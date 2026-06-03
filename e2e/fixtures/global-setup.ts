/**
 * BUG-032 — Playwright globalSetup: one UI login per seeded user, stored
 * via storageState for reuse across probe suites.
 *
 * Why this module exists:
 *   Probe specs previously re-ran loginAs() in beforeEach under serial
 *   mode, meaning ~50 sequential UI logins per suite. The per-user
 *   5-session cap + auth rate limiter together caused the login POST
 *   to hang starting around the 7th iteration (evidence: bug-catalogue.md
 *   §Phase II probes, snapshot captured at test-results/).
 *
 *   This script logs in ONCE per user before any test runs, writes the
 *   browser context state (cookies + localStorage) to e2e/.auth/<user>.json,
 *   and probes then restore that state via test.use({ storageState: ... }).
 *
 * What it does NOT persist:
 *   Playwright storageState captures cookies + localStorage + (optionally)
 *   IndexedDB, NOT sessionStorage (verified against
 *   node_modules/playwright-core/types/types.d.ts:9287-9329). The
 *   GuidedTourOverlay uses sessionStorage, so probe tests re-apply the
 *   tour-dismissed flag via context.addInitScript in e2e/fixtures/auth.ts.
 *
 * Failure mode:
 *   If the setup login lands anywhere other than /dashboard, we screenshot
 *   the final page and throw. First-run problems surface as auth errors,
 *   not silent missing-file noise.
 */

import { chromium, type FullConfig, type Page } from '@playwright/test';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { USERS } from './auth';

const AUTH_DIR = 'e2e/.auth';

// Canonical personas seeded for workflow + probe coverage:
//   superadmin   — cross-clinic/platform authority
//   admin        — clinic admin
//   manager      — manager role
//   receptionist — operational, non-clinical role
//   clinician    — primary clinical role
//   clinician2   — second clinician for matrix and concurrency probes
const USERS_TO_SETUP = [
  'superadmin',
  'admin',
  'manager',
  'receptionist',
  'clinician',
  'clinician2',
] as const;

async function captureFailureScreenshot(page: Page, screenshotPath: string): Promise<string> {
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return '';
  } catch (err) {
    return ` Screenshot capture failed: ${err instanceof Error ? err.message : String(err)}.`;
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:5173';
  mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const userKey of USERS_TO_SETUP) {
      const user = USERS[userKey];
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();

      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      // Pre-set the tour-dismissed flag on the login page so the post-login
      // dashboard render doesn't trigger GuidedTourOverlay mid-storage-state
      // capture. (This applies only to THIS page; probe contexts re-apply
      // via the addInitScript fixture in e2e/fixtures/auth.ts.)
      await page.evaluate(() => sessionStorage.setItem('tour-dismissed', 'true'));
      await page.getByLabel(/email/i).fill(user.email);
      await page.locator('input[name="password"]').fill(user.password);
      await page.getByRole('button', { name: /sign in/i }).click();

      try {
        await page.waitForURL('**/dashboard', { timeout: 30_000 });
      } catch (err) {
        const screenshotPath = `${AUTH_DIR}/${userKey}-setup-failure.png`;
        const screenshotNote = await captureFailureScreenshot(page, screenshotPath);
        await context.close();
        throw new Error(
          `globalSetup: ${userKey} login did not reach /dashboard within 30s. ` +
            `Final URL: ${page.url()}. Screenshot: ${screenshotPath}. ` +
            `Original error: ${err instanceof Error ? err.message : String(err)}.` +
            screenshotNote,
        );
      }

      if (!page.url().endsWith('/dashboard')) {
        const screenshotPath = `${AUTH_DIR}/${userKey}-setup-failure.png`;
        const screenshotNote = await captureFailureScreenshot(page, screenshotPath);
        await context.close();
        throw new Error(
          `globalSetup: ${userKey} landed on ${page.url()} instead of /dashboard. ` +
            `Screenshot: ${screenshotPath}.` +
            screenshotNote,
        );
      }

      await context.storageState({ path: `${AUTH_DIR}/${userKey}.json` });

      // sessionStorage sidecar: the frontend authStore (Zustand) persists
      // only `user` into sessionStorage under 'signacare-auth' via partialize.
      // Playwright's storageState does NOT capture sessionStorage — see
      // node_modules/playwright-core/types/types.d.ts:9287-9329 — so without
      // this sidecar the AuthGuard would see isAuthenticated=false on
      // restored contexts and redirect every probe to /login.
      //
      // authStore.ts:38 now derives isAuthenticated from `!!user` in
      // onRehydrateStorage (fixes the production page-refresh-loses-auth
      // bug that this sidecar originally papered over). We therefore write
      // the raw authStore-persisted value as-is. The sidecar is consumed
      // by the `context` fixture in e2e/fixtures/auth.ts via addInitScript
      // so every new page seeds the key BEFORE React mounts and BEFORE
      // AuthGuard's first render.
      const rawSess = await page.evaluate(() => sessionStorage.getItem('signacare-auth'));
      writeFileSync(`${AUTH_DIR}/${userKey}.sess.json`, rawSess ?? 'null');

      await context.close();
    }
  } finally {
    await browser.close();
  }

  // Final sanity: every expected file exists. Turns silent FS errors into
  // loud startup failures.
  for (const userKey of USERS_TO_SETUP) {
    for (const suffix of ['json', 'sess.json'] as const) {
      const path = `${AUTH_DIR}/${userKey}.${suffix}`;
      if (!existsSync(path)) {
        throw new Error(
          `globalSetup: expected auth file ${path} was not produced. ` +
            `This usually means context.storageState() or sessionStorage ` +
            `capture silently failed — check disk space and directory ` +
            `permissions on ${AUTH_DIR}.`,
        );
      }
    }
  }
}
