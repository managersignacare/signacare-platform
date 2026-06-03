import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config.
 *
 * Projects:
 *   - chromium (default)           — full E2E suite + probes + a11y
 *   - firefox                       — Phase II.H multi-browser — probes + a11y only
 *   - webkit                        — Phase II.H multi-browser — probes + a11y only
 *   - mobile-iphone                 — Phase II.I mobile viewport — probes + a11y only
 *   - mobile-android                — Phase II.I mobile viewport — probes + a11y only
 *   - visual                        — Phase II.L visual regression baseline
 *
 * Run examples:
 *   npm run test:e2e                                              # chromium only (default)
 *   npx playwright test --project=firefox e2e/probes/             # probes on firefox
 *   npx playwright test --project=mobile-iphone e2e/probes/       # probes on iPhone 13
 *   npx playwright test --project=chromium --project=firefox --project=webkit e2e/probes/ e2e/accessibility/
 *   npx playwright test --project=visual e2e/visual/              # visual regression
 *
 * Mobile + secondary-browser projects run ONLY probes + a11y specs,
 * NOT the 94-spec suite (cascade noise from flaky legacy specs).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  testIgnore: ['**/node_modules/**', '**/apps/**'],
  // BUG-032 — one UI login per seeded user; probes restore via storageState
  // to avoid per-test session-cap + rate-limiter thrash. See
  // docs/audit-2026-04-19/bug-plans/BUG-032-login-redirect-storage-state.md.
  globalSetup: './e2e/fixtures/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  projects: [
    // Primary: full E2E + probes + a11y + visual.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },

    // Phase II.H — multi-browser on probes + a11y only.
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testMatch: ['e2e/probes/**/*.spec.ts', 'e2e/accessibility/**/*.a11y.spec.ts'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: ['e2e/probes/**/*.spec.ts', 'e2e/accessibility/**/*.a11y.spec.ts'],
    },

    // Phase II.I — mobile viewport on probes + a11y only.
    {
      name: 'mobile-iphone',
      use: { ...devices['iPhone 13'] },
      testMatch: ['e2e/probes/**/*.spec.ts', 'e2e/accessibility/**/*.a11y.spec.ts'],
    },
    {
      name: 'mobile-android',
      use: { ...devices['Pixel 7'] },
      testMatch: ['e2e/probes/**/*.spec.ts', 'e2e/accessibility/**/*.a11y.spec.ts'],
    },

    // Phase II.L — visual regression.
    {
      name: 'visual',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
      testMatch: ['e2e/visual/**/*.visual.spec.ts'],
    },
  ],
  webServer: [
    {
      command: [
        'cd apps/api &&',
        'API_RATE_LIMIT=1000000',
        'AUTH_RATE_LIMIT=1000000',
        'PATIENT_AUTH_RATE_LIMIT=1000000',
        'UPLOAD_RATE_LIMIT=1000000',
        'LLM_RATE_LIMIT=1000000',
        'npx tsx -r dotenv/config src/server.ts',
      ].join(' '),
      port: 4000,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: 'npm run dev --prefix apps/web',
      port: 5173,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
