import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const workspaceRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Default `pnpm test` (and CI) executes only fast in-process unit tests.
 *
 * The default run excludes both:
 *   1. live-server / Postgres-backed integration suites
 *   2. slower conformance packs that exercise broader external-
 *      integration contracts (for example NPDS/eScript flows)
 *
 * That keeps the unit-test CI lane deterministic and fast. The
 * integration and conformance surfaces belong in their dedicated
 * lanes, not the in-process unit lane.
 */
export default defineConfig({
  root: workspaceRoot,
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
      // CTS / conformance packs cover broader cross-system contracts
      // and are intentionally kept out of the fast unit-test lane.
      'tests/conformance/**',
    ],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
