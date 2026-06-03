/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * React 19 + Vitest component render tests:
 *
 * React 19's CJS/ESM module boundary creates a dual-instance problem
 * in Vitest's jsdom environment — the hooks dispatcher initialised by
 * react-dom/client.createRoot() registers on a different module
 * instance than the one component code resolves to. This causes
 * "Cannot read properties of null (reading 'useMemo')" on any
 * component that uses hooks.
 *
 * Investigated and ruled out (2026-04-16 Phase 0.7.1):
 *   - resolve.alias to force local react/react-dom ❌
 *   - resolve.conditions: ['node'] ❌
 *   - deps.optimizer.web.include ❌
 *   - server.deps.inline ❌
 *   - npm overrides to unify React 19 across monorepo ❌ (fixes
 *     $$typeof but not hooks dispatcher)
 *   - happy-dom instead of jsdom ❌
 *
 * Decision: pure logic tests run in Vitest (no DOM needed). Component
 * render tests use Playwright component testing via the existing E2E
 * infrastructure (proven working). This is the React team's recommended
 * path for React 19 testing until the ecosystem catches up.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@signacare/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  test: {
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    // No jsdom environment — tests are pure logic only.
    // Component render tests go in e2e/ via Playwright.
  },
});
