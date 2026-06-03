import { defineConfig } from 'vitest/config';

/**
 * Live-server integration config.
 *
 * These suites use fetch() against TEST_API_URL and are intentionally
 * excluded from the default vitest.config.ts run. Keeping them in a
 * dedicated config prevents script drift where include patterns point
 * at files that the default config still excludes.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/auth.test.ts',
      'tests/api-endpoints.test.ts',
      'tests/clinical-workflows.test.ts',
    ],
    exclude: ['**/node_modules/**'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    sequence: { concurrent: false },
  },
});
