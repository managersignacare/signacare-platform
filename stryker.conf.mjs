/**
 * Stryker mutation testing config — Phase II.K.
 *
 * Runs against a small, high-value target set rather than the whole
 * codebase. Each target is a pure-logic module where mutation testing
 * gives an honest read on test quality:
 *
 *   - scribeSafetyService.ts — 10-category sensitive-topic detector.
 *     Test-critical: a weak test here lets a critical flag pass as
 *     "low severity".
 *   - phiScrubberService.ts — PHI scrubbing pipeline. Test-critical:
 *     a weak test here lets unredacted PHI into the training corpus.
 *   - auth: login guards + session rotation — if tests rubber-stamp,
 *     a token-rotation bug ships silently.
 *
 * The standard mutation score thresholds:
 *   - high: 80 → green
 *   - low: 60 → amber
 *   - break: 50 → CI fails
 *
 * Setup (not yet installed; run `npm i -D` once to enable):
 *   npm i -D @stryker-mutator/core @stryker-mutator/vitest-runner \
 *     @stryker-mutator/typescript-checker
 *
 * Run once installed:
 *   npx stryker run
 *
 * Results → reports/mutation/ (HTML + text summary).
 *
 * Why not everything: mutation testing is O(tests × mutations) →
 * running the full suite per mutation on 273 React files is
 * prohibitive. Scope ruthlessly: 5 pure-logic modules is enough
 * signal for the test-quality audit.
 */
export default {
  mutate: [
    'apps/api/src/features/llm/scribeSafetyService.ts',
    'apps/api/src/features/llm/phiScrubberService.ts',
    'apps/api/src/mcp/scribeEnhancements.ts',
    'apps/api/src/shared/escapeLike.ts',
    'apps/api/src/features/events/sseRoutes.ts',
  ],
  testRunner: 'vitest',
  vitest: {
    configFile: 'apps/api/vitest.config.ts',
  },
  coverageAnalysis: 'perTest',
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },
  reporters: ['progress', 'clear-text', 'html'],
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  tsconfigFile: 'apps/api/tsconfig.json',
  disableTypeChecks: 'apps/api/**/*.ts',
  ignorePatterns: [
    'node_modules',
    'dist',
    'build',
    '**/*.test.ts',
    '**/*.spec.ts',
  ],
};
