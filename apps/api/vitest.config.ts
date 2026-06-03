import { defineConfig } from 'vitest/config';

/**
 * Default `pnpm test` (and CI) executes only fast in-process unit tests.
 *
 * The three live-server integration suites — auth, api-endpoints,
 * clinical-workflows — depend on a real running API at TEST_API_URL
 * with seeded admin credentials. They are excluded from the default
 * run and executed via `pnpm test:integration` against a deployed
 * environment.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      // Live-server fetch suites — need a process running on :4000.
      'tests/auth.test.ts',
      'tests/api-endpoints.test.ts',
      'tests/clinical-workflows.test.ts',
      // Category 2 in-process supertest suites — need a real Postgres
      // with migrations + the seeded admin user. Run via
      // `pnpm test:integration` after `docker compose up postgres`.
      'tests/integration/**',
    ],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
