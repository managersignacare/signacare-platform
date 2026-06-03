import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

// Actual DB credentials (from seed data — @signacare.local domain)
export const USERS = {
  superadmin:   { email: 'admin@signacare.local',        password: 'Password1!', role: 'superadmin' },
  admin:        { email: 'tom.obrien@signacare.local',   password: 'Password1!', role: 'admin' },
  manager:      { email: 'mia.manager@signacare.local',  password: 'Password1!', role: 'manager' },
  receptionist: { email: 'riley.reception@signacare.local', password: 'Password1!', role: 'receptionist' },
  clinician:    { email: 'sarah.chen@signacare.local',   password: 'Password1!', role: 'clinician' },
  clinician2:   { email: 'james.wilson@signacare.local', password: 'Password1!', role: 'clinician' },
} as const;

type UserKey = keyof typeof USERS;

/** Login via the UI form */
export async function loginAs(page: Page, userKey: UserKey) {
  const user = USERS[userKey];
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  // Pre-emptively dismiss the guided tour popup via sessionStorage BEFORE login completes.
  // The GuidedTourOverlay reads sessionStorage on mount, so setting it early prevents the tour
  // from rendering at all when the app shell loads after login.
  await page.evaluate(() => sessionStorage.setItem('tour-dismissed', 'true'));
  const emailInput = page
    .getByLabel(/email/i)
    .or(page.locator('input[name="email"]'))
    .or(page.locator('input[type="email"]'))
    .first();
  await expect(emailInput).toBeVisible({ timeout: 15_000 });
  await emailInput.fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
  await ensureMainNavigationClosed(page);
}

/** Alias for compatibility */
export const loginViaApi = loginAs;

/** Navigate using client-side routing (pushState + popstate) */
export async function navigateTo(page: Page, path: string) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForTimeout(500);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SIDEBAR_NAV_CONFIG: Record<string, { label?: string; group?: string }> = {
  intake: { label: 'Mental Health Intake', group: 'Clinical Lists' },
  'mental health intake': { group: 'Clinical Lists' },
  'referral queue': { group: 'Clinical Lists' },
  lai: { group: 'Clinical Lists' },
  'mh act': { group: 'Clinical Lists' },
  'group therapy': { group: 'Clinical Lists' },
  clozapine: { group: 'Clinical Lists' },
  '91-day review': { group: 'Clinical Lists' },
  'hot spots': { group: 'Clinical Lists' },
  handover: { group: 'Clinical Lists' },
  appointments: { group: 'Workspace' },
  'my calendar': { group: 'Workspace' },
  'bed board': { group: 'Workspace' },
  reception: { group: 'Workspace' },
  reports: { group: 'Admin' },
  templates: { group: 'Admin' },
  billing: { group: 'Admin' },
  exports: { group: 'Admin' },
  resources: { group: 'Admin' },
  'org settings': { group: 'Settings' },
  'staff assignments': { group: 'Settings' },
  'power settings': { group: 'Platform' },
  subscription: { group: 'Platform' },
};

async function isMainNavigationVisible(page: Page): Promise<boolean> {
  return page.locator('nav[aria-label="Main navigation"]').isVisible({ timeout: 1_000 }).catch(() => false);
}

async function ensureMainNavigationOpen(page: Page): Promise<void> {
  if (await isMainNavigationVisible(page)) return;

  const toggleButton = page.getByRole('button', { name: /toggle sidebar/i }).first();
  if (await toggleButton.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await toggleButton.click();
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 5_000 });
  }
}

export async function ensureMainNavigationClosed(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width > 900) return;

  const nav = page.locator('nav[aria-label="Main navigation"]');
  if (!(await nav.isVisible({ timeout: 1_000 }).catch(() => false))) return;

  const toggleCandidates = [
    nav.getByRole('button', { name: /toggle sidebar/i }).first(),
    page.getByRole('button', { name: /toggle sidebar/i }).first(),
  ];

  for (const toggle of toggleCandidates) {
    if (!(await toggle.isVisible({ timeout: 1_000 }).catch(() => false))) continue;
    await toggle.click();
    if (await nav.isHidden({ timeout: 3_000 }).catch(() => false)) return;
  }

  // Some mobile drawer variants ignore the toggle while animating; click
  // outside the drawer as a deterministic close fallback.
  await page.mouse.click(Math.max(8, viewport.width - 8), Math.max(8, Math.floor(viewport.height / 2))).catch(() => {});
  if (await nav.isHidden({ timeout: 2_000 }).catch(() => false)) return;

  await page.keyboard.press('Escape').catch(() => {});
  await expect(nav).toBeHidden({ timeout: 3_000 });
}

async function expandSidebarGroupIfCollapsed(page: Page, group: string): Promise<void> {
  const nav = page.locator('nav[aria-label="Main navigation"]');
  const groupToggle = nav
    .getByRole('button', { name: new RegExp(`^${escapeRegExp(group)} navigation group`, 'i') })
    .first();
  if (!(await groupToggle.isVisible({ timeout: 1_500 }).catch(() => false))) return;
  const expanded = await groupToggle.getAttribute('aria-expanded');
  if (expanded === 'false') {
    await groupToggle.click();
    await expect(groupToggle).toHaveAttribute('aria-expanded', 'true', { timeout: 5_000 });
  }
}

/** Navigate via sidebar button (scoped to nav, resilient to aria-live status text). */
export async function navigateViaSidebar(page: Page, label: string) {
  await ensureMainNavigationOpen(page);

  const requestedLabel = label.trim();
  const navConfig = SIDEBAR_NAV_CONFIG[requestedLabel.toLowerCase()];
  const targetLabel = navConfig?.label ?? requestedLabel;
  const nav = page.locator('nav[aria-label="Main navigation"]');
  await expect(nav).toBeVisible({ timeout: 10_000 });

  if (navConfig?.group) {
    await expandSidebarGroupIfCollapsed(page, navConfig.group);
  }

  const requestedExact = nav
    .getByRole('button', { name: new RegExp(`^${escapeRegExp(requestedLabel)}$`, 'i') })
    .first();
  const targetExact = nav
    .getByRole('button', { name: new RegExp(`^${escapeRegExp(targetLabel)}$`, 'i') })
    .first();
  const targetFuzzy = nav
    .getByRole('button', { name: new RegExp(escapeRegExp(targetLabel), 'i') })
    .first();

  const candidates = [requestedExact, targetExact, targetFuzzy];
  let clicked = false;
  for (const candidate of candidates) {
    if (await candidate.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await candidate.click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    const visibleButtons = (await nav.getByRole('button').allInnerTexts()).map((text) => text.trim()).filter(Boolean);
    throw new Error(
      `navigateViaSidebar could not find "${requestedLabel}" (resolved as "${targetLabel}"). ` +
      `Visible sidebar buttons: ${visibleButtons.join(' | ')}`,
    );
  }
  await page.waitForTimeout(500);
  await ensureMainNavigationClosed(page);
}

/**
 * Navigate to a patient's detail page by searching the patient list.
 * Clears default filters to ensure patients are visible.
 * Returns the patient ID from the URL.
 */
export async function navigateToPatient(page: Page, searchName: string): Promise<string> {
  await navigateViaSidebar(page, 'Patients');
  await page.waitForTimeout(1000);

  const searchInput = page.getByPlaceholder(/search/i).first();
  await expect(searchInput).toBeVisible({ timeout: 10_000 });

  const applySearch = async () => {
    await searchInput.clear();
    await searchInput.fill(searchName);
    await page.waitForTimeout(1500); // debounce + API
    const noResults = page.getByText(/no patients found/i);
    if (await noResults.isVisible().catch(() => false)) {
      await searchInput.clear();
      await page.waitForTimeout(1500);
    }
  };

  await applySearch();

  const rows = page.locator('table tbody tr');
  const rowCount = await rows.count();
  if (rowCount === 0) {
    throw new Error(`navigateToPatient could not find any patient rows for search "${searchName}"`);
  }

  const maxRowsToTry = Math.min(rowCount, 12);
  for (let rowIndex = 0; rowIndex < maxRowsToTry; rowIndex += 1) {
    const row = rows.nth(rowIndex);
    const rowText = (await row.innerText().catch(() => '')).toLowerCase();
    if (rowText.includes('no patients found')) break;

    const openFromCell = async (cellIndex: number): Promise<boolean> => {
      const targetCell = row.locator('td').nth(cellIndex);
      if (!(await targetCell.isVisible().catch(() => false))) return false;
      try {
        await Promise.all([
          page.waitForURL(/\/patients\/[a-f0-9-]+(?:\?.*)?$/, { timeout: 8_000 }),
          targetCell.click(),
        ]);
        return true;
      } catch {
        return false;
      }
    };

    const opened = (await openFromCell(0)) || (await openFromCell(1));
    if (!opened) continue;

    await page.waitForTimeout(800);
    const loadFailed = await page.getByText('Failed to load patient record.').isVisible().catch(() => false);
    if (!loadFailed) {
      await dismissTourPopup(page);
      const url = page.url();
      const match = url.match(/patients\/([a-f0-9-]+)/);
      if (!match?.[1]) {
        throw new Error(`navigateToPatient reached detail route but could not parse patient id. URL: ${url}`);
      }
      const patientId = match[1];
      // Some role/record combinations allow opening the patient shell
      // but deny downstream episode/task/appointment reads (403
      // NO_PATIENT_RELATIONSHIP). Verify episode access before
      // accepting this row as a valid navigation target.
      const hasEpisodeAccess = await page.evaluate(async (pid: string) => {
        try {
          const res = await fetch(`/api/v1/episodes/patient/${pid}`, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'X-CSRF-Token': 'test',
              'X-Client': 'mobile',
            },
          });
          return res.status !== 403;
        } catch {
          return false;
        }
      }, patientId);
      if (hasEpisodeAccess) return patientId;
    }

    await navigateViaSidebar(page, 'Patients');
    await page.waitForTimeout(800);
    await applySearch();
  }

  throw new Error(
    `navigateToPatient could not open an accessible patient detail record from the first ${maxRowsToTry} rows for search "${searchName}"`,
  );
}

const PATIENT_TAB_ID_BY_NAME: Record<string, string> = {
  'alerts & plans': 'alerts-plans',
  alerts: 'alerts-plans',
  correspondence: 'correspondence',
  referrals: 'referrals',
  documents: 'documents',
  episodes: 'episodes',
  medications: 'medications',
  'medication history': 'medication-history',
};

const PATIENT_TAB_LABEL_BY_NAME: Record<string, string> = {
  'alerts & plans': 'Alerts & Plans',
  alerts: 'Alerts & Plans',
  correspondence: 'Information Exchange',
  referrals: 'Information Exchange',
  documents: 'Information Exchange',
  episodes: 'Episodes',
  medications: 'Active Medications',
  'medication history': 'Medication History',
};

/**
 * Navigate to a specific tab on the current patient detail page.
 */
export async function clickPatientTab(page: Page, tabName: string) {
  await ensureMainNavigationClosed(page);

  const normalised = tabName.trim().toLowerCase();
  const mappedLabel = PATIENT_TAB_LABEL_BY_NAME[normalised] ?? tabName;
  const topTabCandidates = [
    page.getByRole('tab', { name: new RegExp(`^${escapeRegExp(mappedLabel)}$`, 'i') }),
    page.getByRole('tab', { name: new RegExp(`^${escapeRegExp(tabName)}$`, 'i') }),
  ];
  for (const topTab of topTabCandidates) {
    if (await topTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await topTab.click();
      await page.waitForTimeout(500);
      return;
    }
  }

  const sideNavCandidates = [
    page.getByRole('button', { name: new RegExp(`open ${escapeRegExp(mappedLabel)} tab`, 'i') }),
    page.getByRole('button', { name: new RegExp(`open ${escapeRegExp(tabName)} tab`, 'i') }),
  ];
  for (const sideNavTab of sideNavCandidates) {
    if (!(await sideNavTab.isVisible({ timeout: 10_000 }).catch(() => false))) continue;
    await sideNavTab.click();
    await page.waitForTimeout(500);

    if (normalised === 'correspondence' || normalised === 'referrals' || normalised === 'documents') {
      const nestedTab = page.getByRole('tab', { name: new RegExp(`^${escapeRegExp(tabName)}$`, 'i') });
      if (await nestedTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await nestedTab.click();
        await page.waitForTimeout(400);
      }
    }
    return;
  }

  const tabId = PATIENT_TAB_ID_BY_NAME[normalised];
  if (tabId) {
    const currentUrl = new URL(page.url());
    currentUrl.searchParams.set('tab', tabId);
    await page.goto(currentUrl.toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    return;
  }

  throw new Error(`clickPatientTab could not find a tab control for "${tabName}" (mapped: "${mappedLabel}")`);
}

/**
 * Dismiss the GuidedTour "Take a Tour" popup if it is visible.
 * This popup can overlay dialog buttons on patient detail pages.
 * Sets sessionStorage to prevent it from reappearing.
 */
export async function dismissTourPopup(page: Page) {
  // Set sessionStorage to mark tour as dismissed — prevents re-render even if React re-mounts
  try {
    await page.evaluate(() => sessionStorage.setItem('tour-dismissed', 'true'));
  } catch { /* ignore */ }

  // If the tour popup is already visible, click the close button to dismiss it immediately
  try {
    const closeBtn = page.locator('button:has(svg[data-testid="CloseIcon"])').first();
    if (await closeBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(300);
    }
  } catch { /* not visible — already handled via sessionStorage */ }
}

/**
 * Phase II.A.2 — console + pageerror capture.
 *
 * Every test run via this extended `test` gets automatic console-error
 * + pageerror capture. At test teardown, if anything unexpected landed
 * in the console the test fails with a summary. Opt out by setting
 * `test.info().annotations.push({ type: 'console-ok', description: '...' })`
 * OR calling `consoleLog.allow(/regex/)` from inside the test.
 *
 * Catches Bug 6 class across the whole suite without writing a spec
 * per surface. The allowlist below suppresses known-benign React
 * warnings so the signal-to-noise stays high.
 */
const CONSOLE_ALLOW_PATTERNS: RegExp[] = [
  // Dev-only React hydration warnings — benign in SPA.
  /React does not recognize the .* prop on a DOM element/i,
  // Vite HMR connection noise.
  /vite connected|\[vite\]/i,
  // Dev tools / React Query devtools.
  /React DevTools|query client/i,
  // MUI deprecation warnings — noise, not bugs.
  /deprecated/i,
  // TanStack Query v5 network errors when offline — expected in test env.
  /Query failed with status code/i,
];

export interface ConsoleCapture {
  errors: string[];
  warnings: string[];
  pageErrors: string[];
  allow: (pattern: RegExp) => void;
}

function createConsoleCapture(page: Page, extraAllow: RegExp[]): ConsoleCapture {
  const allow = [...CONSOLE_ALLOW_PATTERNS, ...extraAllow];
  const capture: ConsoleCapture = {
    errors: [], warnings: [], pageErrors: [],
    allow: (p) => allow.push(p),
  };
  const isAllowed = (text: string) => allow.some((r) => r.test(text));

  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error' && !isAllowed(text)) capture.errors.push(text);
    else if (type === 'warning' && !isAllowed(text)) capture.warnings.push(text);
  });
  page.on('pageerror', (err) => {
    if (!isAllowed(err.message)) capture.pageErrors.push(err.message);
  });
  return capture;
}

/** Extended test fixture with pre-authenticated page + console capture */
type AuthPersona =
  | 'superadmin'
  | 'admin'
  | 'manager'
  | 'receptionist'
  | 'clinician'
  | 'clinician2'
  | 'none';

/**
 * BUG-032 — single source of truth for (storageState, authPersona) pairs.
 * Probe specs declare `test.use(useAs('superadmin'))` (or another persona)
 * and both values travel
 * together — no possibility of declaring storageState for user X while
 * the sessionStorage sidecar loads for user Y.
 *
 * Returns the exact shape accepted by Playwright's `test.use`.
 */
export function useAs(persona: Exclude<AuthPersona, 'none'>): {
  storageState: string;
  authPersona: AuthPersona;
} {
  return {
    storageState: `e2e/.auth/${persona}.json`,
    authPersona: persona,
  };
}

export const test = base.extend<{
  authedPage: Page;
  consoleCapture: ConsoleCapture;
  /**
   * BUG-032 — which seeded user's sessionStorage to hydrate on every new
   * page. Defaults to 'none' (L5 review — explicit-over-implicit): every
   * auth-requiring spec must declare its persona via `useAs('superadmin')`
   * etc.
   * so the authenticated surface a test exercises is never implicit.
   *
   * 01-auth.spec.ts inherits the 'none' default because it tests the real
   * login UI and MUST NOT start authenticated.
   */
  authPersona: AuthPersona;
}>({
  authPersona: ['none', { option: true }],
  // BUG-032 — Playwright storageState persists cookies + localStorage +
  // (optionally) IndexedDB but NOT sessionStorage (see
  // node_modules/playwright-core/types/types.d.ts:9287-9329).
  //
  // Two sessionStorage keys are load-bearing:
  //  (1) 'signacare-auth' — Zustand authStore persist-layer (sessionStorage).
  //      Without this, AuthGuard sees isAuthenticated=false and redirects
  //      every probe to /login.
  //  (2) 'tour-dismissed' — GuidedTourOverlay dismiss flag. Without this
  //      the tour overlay re-opens on every protected route.
  //
  // globalSetup writes `e2e/.auth/<persona>.sess.json` alongside the main
  // storageState file. This fixture reads the sidecar and addInitScripts
  // the value so every new page seeds BOTH keys BEFORE any React code
  // mounts and before AuthGuard's first render.
  context: async ({ context, authPersona, browserName }, use) => {
    // WebKit has shown intermittent dynamic-import failures when the Vite
    // dev server serves module responses via conditional 304 paths during
    // fast route churn. Force fresh module responses in WebKit contexts by
    // stripping conditional cache headers at request time.
    if (browserName === 'webkit') {
      await context.route('http://localhost:5173/**', async (route) => {
        const original = route.request().headers();
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(original)) {
          const lower = key.toLowerCase();
          if (
            lower === 'if-none-match'
            || lower === 'if-modified-since'
            || lower === 'if-match'
            || lower === 'if-unmodified-since'
            || lower === 'if-range'
          ) {
            continue;
          }
          headers[key] = value;
        }
        // Force fresh module responses in WebKit to avoid intermittent
        // lazy-import failures caused by conditional 304 code paths.
        headers['cache-control'] = 'no-cache';
        headers.pragma = 'no-cache';
        await route.continue({ headers });
      });
    }

    let authSess: string | null = null;
    if (authPersona !== 'none') {
      const sessPath = join('e2e', '.auth', `${authPersona}.sess.json`);
      try {
        const raw = readFileSync(sessPath, 'utf8').trim();
        // Sidecar literally contains the string 'null' when globalSetup
        // couldn't read the key (e.g. login never rendered the dashboard).
        authSess = raw && raw !== 'null' ? raw : null;
        if (authSess) {
          // Defensive parse — a poisoned sidecar (e.g. partial write, wrong
          // JSON shape) would silently fail to hydrate the authStore and
          // the test would redirect to /login. Warn to stderr so the
          // failure mode is visible in test output rather than buried.
          try {
            JSON.parse(authSess);
          } catch (parseErr) {
            // eslint-disable-next-line no-console
            console.warn(
              `[auth fixture] malformed sidecar at ${sessPath}: ` +
                (parseErr instanceof Error ? parseErr.message : String(parseErr)) +
                '. Test will likely redirect to /login. Regenerate via ' +
                'a fresh Playwright run (globalSetup overwrites on each run).',
            );
            authSess = null;
          }
        }
      } catch {
        // Missing file — fall through without hydrating auth. Tests relying
        // on authenticated state will surface as /login redirects, which is
        // the loud-failure mode we want.
      }
    }
    await context.addInitScript(
      ({ authSessKey, authSessValue }) => {
        try {
          sessionStorage.setItem('tour-dismissed', 'true');
          if (authSessValue !== null) {
            sessionStorage.setItem(authSessKey, authSessValue);
          }
        } catch {
          // sessionStorage may be unavailable in rare sandboxed contexts.
        }
      },
      { authSessKey: 'signacare-auth', authSessValue: authSess },
    );
    await use(context);
  },
  authedPage: async ({ page }, use) => {
    await loginAs(page, 'admin');
    await use(page);
  },
  consoleCapture: async ({ page }, use, testInfo) => {
    const capture = createConsoleCapture(page, []);
    await use(capture);
    // On any test completion (pass OR fail), surface captured console
    // issues as attachments. For tests flagged strict-console, throw so
    // the test actually fails on console leakage.
    const strictConsole = testInfo.annotations.some(a => a.type === 'strict-console');
    const summary = {
      errors: capture.errors,
      warnings: capture.warnings,
      pageErrors: capture.pageErrors,
    };
    if (capture.errors.length || capture.pageErrors.length || capture.warnings.length) {
      await testInfo.attach('console-capture.json', {
        body: JSON.stringify(summary, null, 2),
        contentType: 'application/json',
      });
    }
    if (strictConsole && (capture.errors.length || capture.pageErrors.length)) {
      throw new Error(
        `Unexpected console output:\n` +
        `  errors: ${capture.errors.length}\n` +
        `  pageErrors: ${capture.pageErrors.length}\n` +
        `  warnings: ${capture.warnings.length}\n` +
        summary.errors.slice(0, 3).map(e => `  - ${e}`).join('\n') +
        (summary.pageErrors.length ? '\n  pageError: ' + summary.pageErrors[0] : ''),
      );
    }
  },
});

export { expect };
