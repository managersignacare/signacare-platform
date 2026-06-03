import { defineConfig } from 'vitest/config';

/*
 * packages/shared vitest config — BUG-530.
 *
 * Scoped to packages/shared/src so the @signacare/shared SSoT modules
 * (UIStatus, Result, AppError) have first-class test coverage. The root
 * vitest.config.ts is BUG-528-scoped to scripts/**\/*.test.ts; per-workspace
 * tests run with their own configs (apps/api has its own; this is the new
 * sibling for the shared package).
 *
 * Node environment — these are pure type/utility modules with no DOM,
 * React, or filesystem touch.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    typecheck: {
      // Honour `// @ts-expect-error` comments in tests as the canonical
      // compile-time exhaustiveness contract pin (BUG-530 SM-7 / RES-3).
      enabled: false,
    },
  },
});
