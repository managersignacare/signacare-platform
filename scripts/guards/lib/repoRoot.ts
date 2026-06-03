/**
 * scripts/guards/lib/repoRoot.ts
 *
 * Phase 0a.11 absorb of L5 0a.10 non-blocking advisory #1.
 *
 * Single source of truth for `REPO_ROOT` derivation. Both
 * `check-discipline-files-structural.ts` (Phase 0a.10) and
 * `check-runtime-evidence-staleness.ts` (Phase 0a.10) introduced the
 * same script-relative derivation pattern. Phase 0a.11 adds a 3rd
 * caller (`check-no-hardcoded-plan-path.ts`) — at 3 callers the
 * duplication-extraction threshold is reached, so this helper is
 * extracted to eliminate the N-place-update class.
 *
 * The pattern works in both:
 *   - Local CommonJS (tsx) — `__dirname` is defined.
 *   - ESM (modern Node) — `__dirname` is NOT defined; use
 *     `dirname(fileURLToPath(import.meta.url))` instead.
 *
 * REPO_ROOT is computed from THIS lib's own location (not from each caller's
 * location). Callers do NOT need to reproduce the resolve themselves; they
 * just import `REPO_ROOT` and use it. The 3-level resolve below is internal
 * to this lib (because `lib/` is 3 directories deep from the repo root:
 * `<repo>/scripts/guards/lib/`).
 *
 * Constraint for future helpers placed under `scripts/guards/lib/`: do NOT
 * import from this file (importing would resolve correctly because it
 * doesn't change SCRIPT_DIR), but if a future helper needs its OWN repo
 * root for some other reason it should use the same pattern, not this lib.
 *
 * Usage from any guard file:
 *   import { REPO_ROOT } from './lib/repoRoot';
 *   const ALLOWLIST_PATH = path.join(REPO_ROOT, 'scripts/guards/<name>.allowlist');
 */

import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

// SCRIPT_DIR is `<repo>/scripts/guards/lib`. Three levels up → repo root.
export const REPO_ROOT: string = resolve(SCRIPT_DIR, '..', '..', '..');
