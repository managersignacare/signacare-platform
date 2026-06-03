import { defineConfig } from 'vitest/config';

/**
 * Integration test config — Category 2 supertest suites that mount the
 * real Express app in-process and hit a live PostgreSQL.
 *
 * Run with: pnpm test:integration  (which is `vitest --config vitest.integration.config.ts`)
 *
 * The default `vitest.config.ts` excludes `tests/integration/**` from
 * `pnpm test` so unit runs stay fast and infra-free. This file flips
 * that — it ONLY runs the integration tree, and it leaves the live-
 * server fetch suites (auth.test.ts, api-endpoints.test.ts,
 * clinical-workflows.test.ts) excluded because they target a process
 * on :4000, not the in-process app.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    setupFiles: ['./tests/setup.ts'],
    // Integration tests do real I/O (DB, transactions). Give them more room.
    testTimeout: 30000,
    hookTimeout: 60000,
    // Run sequentially to avoid duplicate-detection / unique-constraint
    // races between tests sharing the same seed admin and clinic.
    sequence: { concurrent: false },
    // Keep a single worker and shared module graph across files so the
    // loginAsAdmin() session cache in _helpers.ts is reused. Multiple
    // concurrent forks surface flaky auth-path interactions (audit-write
    // batching + Knex transaction lifecycle) that this infra should avoid.
    pool: 'threads',
    maxWorkers: 1,
    fileParallelism: false,
    isolate: false,
  },
});
