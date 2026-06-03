/*
 * eslint-plugins/signacare-rules/index.js
 *
 * BUG-531 + BUG-447-CASCADE-1 — local ESLint plugin registry.
 * ESLint 8 legacy plugin shape: `module.exports.rules` is a map
 * from rule-name to rule-module. Wired in `.eslintrc.cjs` via
 * `plugins: ['signacare-rules']`.
 */

module.exports = {
  rules: {
    'no-empty-catch-on-safety-surface': require('./rules/no-empty-catch-on-safety-surface'),
    'no-onclick-on-mui-container': require('./rules/no-onclick-on-mui-container'),
  },
};
