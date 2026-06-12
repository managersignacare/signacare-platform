/**
 * Category 7 — dependency-cruiser config for Signacare EMR.
 *
 * Healthcare-grade architecture rules. The set is intentionally
 * narrow: catch the four import patterns that, in this codebase's
 * audit history, repeatedly cause hard-to-trace bugs.
 *
 *   1. No circular dependencies — they break tree-shaking, hide
 *      load-order bugs, and turn refactors into nightmares.
 *   2. No route → route imports — keeps the routing layer flat.
 *   3. No service → route imports — services should be reusable
 *      from any caller (jobs, scribe, MCP server).
 *   4. No app code → test code — a wildcard test import in src/
 *      means a test fixture is sneaking into production bundles.
 *
 * Rules NOT enforced today (left as future tightening):
 *   - apps/web → apps/api direct imports — already impossible
 *     because they're separate workspaces, but a packages/* shared
 *     boundary would benefit from explicit assertion.
 *   - features/X → features/Y cross-feature imports — too noisy to
 *     enforce in one PR; should be opted-in feature-by-feature.
 *
 * Run:
 *   npx depcruise --config .dependency-cruiser.cjs apps/api/src
 *   npx depcruise --validate --config .dependency-cruiser.cjs apps/api/src
 *
 * The validate form returns exit code 1 on any forbidden rule hit,
 * which is what the architecture-quality test wires into vitest.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular dependencies break tree-shaking, hide load-order bugs, ' +
        'and make refactors enormously harder. Refactor the cycle out.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-route-to-route',
      severity: 'error',
      comment:
        'Route files must not import other route files for shared ' +
        'logic — extract a service or util instead. The legitimate ' +
        'exception is sub-router composition (`router.use(otherRouter)`), ' +
        'or route-registration composition inside the same feature, ' +
        'where the imported file is explicitly mounted by the parent. ' +
        'Known sub-router mounts are allowlisted in pathNot below.',
      from: { path: 'apps/api/src/features/.+/.*[Rr]outes\\.ts$' },
      to: {
        path: 'apps/api/src/features/.+/.*[Rr]outes\\.ts$',
        // Allowlist: Express sub-router mounts where the parent
        // router.use()s the child. These are valid composition,
        // not coupling.
        pathNot: [
          'apps/api/src/features/llm/llmTrainingRoutes\\.ts$',
          // Phase 0.7.2: god route decomposed into 6 sub-routers
          'apps/api/src/features/roles/receptionistFeatureRoutes\\.ts$',
          'apps/api/src/features/roles/managerFeatureRoutes\\.ts$',
          'apps/api/src/features/roles/nurseFeatureRoutes\\.ts$',
          'apps/api/src/features/roles/caseManagerFeatureRoutes\\.ts$',
          'apps/api/src/features/roles/psychiatristFeatureRoutes\\.ts$',
          'apps/api/src/features/roles/psychologistFeatureRoutes\\.ts$',
          'apps/api/src/features/roles/crossRoleFeatureRoutes\\.ts$',
          // Power-settings parent router composing sanctioned sub-routers.
          'apps/api/src/features/power-settings/sessionIdleSettingRoutes\\.ts$',
          'apps/api/src/features/power-settings/retentionSettingRoutes\\.ts$',
          'apps/api/src/features/power-settings/retentionApprovalRoutes\\.ts$',
          // BUG-330: scribe parent router composing sanctioned sub-routers.
          'apps/api/src/features/llm/scribeSessionRoutes\\.ts$',
          'apps/api/src/features/llm/scribeConsentRoutes\\.ts$',
          'apps/api/src/features/llm/scribeCatalogRoutes\\.ts$',
          'apps/api/src/features/llm/scribeParityRoutes\\.ts$',
          // Pathways parent router composing sanctioned behavioral sub-router.
          'apps/api/src/features/treatment-pathways/behavioralPathwayRoutes\\.ts$',
          // Patients parent router registering sanctioned ancillary patient routes.
          'apps/api/src/features/patients/patientAncillaryRoutes\\.ts$',
        ],
      },
    },
    {
      name: 'no-service-to-route',
      severity: 'error',
      comment:
        'Service files must not import route files. Services should be ' +
        'callable from jobs, MCP servers, and scribe pipelines without ' +
        'pulling in Express middleware.',
      from: { path: 'apps/api/src/features/.+/.*[Ss]ervice\\.ts$' },
      to: { path: 'apps/api/src/features/.+/.*[Rr]outes\\.ts$' },
    },
    {
      name: 'no-src-to-test',
      severity: 'error',
      comment:
        'Production source must not import test fixtures or test files. ' +
        'Imports from `tests/` indicate a fixture leak into the bundle.',
      from: { path: '^apps/api/src/' },
      to: { path: '^apps/api/tests/' },
    },
    // Orphan-module detection is intentionally NOT enforced via
    // depcruise here — its safe-regex linter rejects the bracket-
    // alternation patterns we'd need. Dead-code detection is delegated
    // to knip (see knip.json) which has a richer model of entry
    // points and runs faster on this codebase.
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    // Skip tsConfig — depcruise's built-in TS resolver is sufficient
    // for the import-graph view we need (forbidden rules), and
    // pulling in the workspace tsconfig has cwd-relative path
    // resolution headaches across the monorepo.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['main', 'types'],
    },
    // Don't crawl into the @signacare/shared workspace (different concern,
    // separately validated by its own tsconfig).
    moduleSystems: ['cjs', 'es6'],
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
