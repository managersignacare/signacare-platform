/**
 * BUG-AD family regression guard:
 * advance-directive routes must not reintroduce route-local role arrays
 * (e.g. requireRoles(['clinician', ...])).
 *
 * Authoritative posture:
 *   1) module access middleware gates feature visibility
 *   2) requireClinicalAccessRole(auth) blocks operational-only roles
 *   3) service-layer permission checks enforce action-level rights
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const TARGET = resolve(
  REPO_ROOT,
  'apps/api/src/features/advance-directives/advanceDirectiveRoutes.ts',
);

const FORBIDDEN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\brequireRoles\s*\(/, label: 'requireRoles(...) call' },
  { re: /\bconst\s+ROLES\s*=\s*\[/, label: 'local ROLES literal' },
];

function main(): number {
  const src = readFileSync(TARGET, 'utf8');
  const violations = FORBIDDEN_PATTERNS
    .filter((entry) => entry.re.test(src))
    .map((entry) => entry.label);

  if (violations.length > 0) {
    console.error('check-no-hardcoded-role-literal-advance-directives: FAIL');
    for (const v of violations) {
      console.error(`  - found forbidden pattern: ${v}`);
    }
    console.error(
      'Advance-directive routes must use module-access + requireClinicalAccessRole(auth) + service permissions.',
    );
    return 1;
  }

  if (!/\brequireClinicalAccessRole\s*\(/.test(src)) {
    console.error('check-no-hardcoded-role-literal-advance-directives: FAIL');
    console.error('  - missing requireClinicalAccessRole(...) enforcement in advanceDirectiveRoutes.ts');
    return 1;
  }

  console.log(
    'check-no-hardcoded-role-literal-advance-directives: PASS (no route-local role literal on advance-directive routes)',
  );
  return 0;
}

process.exit(main());
