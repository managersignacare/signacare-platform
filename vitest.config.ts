import { defineConfig } from 'vitest/config';

/**
 * Root vitest config — scoped to scripts/**\/*.test.ts (the CI guard
 * test suites) AND eslint-plugins/**\/*.test.js (BUG-531 ESLint plugin
 * RuleTester suites). Workspace tests for apps/api, apps/web,
 * packages/shared have their own per-workspace configs and are NOT
 * picked up here.
 *
 * BUG-528 introduced this file. BUG-531 added the eslint-plugins glob.
 *
 * Run: npm run test:guards
 */
export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts', 'eslint-plugins/**/*.test.js'],
    environment: 'node',
    globals: false,
  },
});
