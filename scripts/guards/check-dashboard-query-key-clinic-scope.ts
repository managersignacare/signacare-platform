#!/usr/bin/env tsx
/**
 * BUG-SA-106
 *
 * Structural guard for dashboard React Query key isolation.
 * Ensures dashboard key factories remain clinic-scoped and do not regress to
 * legacy flat string-key namespaces.
 */

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const QUERY_KEYS_FILE = resolve(ROOT, 'apps', 'web', 'src', 'features', 'dashboard', 'queryKeys.ts');

function main(): void {
  const src = readFileSync(QUERY_KEYS_FILE, 'utf8');
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  const failures: string[] = [];

  if (!stripped.includes('function clinicScopeToken(')) {
    failures.push('missing clinicScopeToken helper');
  }

  // Explicitly ban legacy flat-string key roots that break prefix invalidation
  // and clinic context isolation.
  if (/\[[\s]*['"]dash-[^'"]*['"]/.test(stripped)) {
    failures.push('legacy flat dash-* query keys detected');
  }
  if (/\[[\s]*['"]dashboard-[^'"]*['"]/.test(stripped)) {
    failures.push('legacy flat dashboard-* query keys detected');
  }

  // Every key function under dashboardKeys must reference clinicScopeToken.
  const keyMatch = stripped.match(/export const dashboardKeys = \{([\s\S]*?)\}\s+as const;/);
  if (!keyMatch) {
    failures.push('could not parse dashboardKeys object');
  } else {
    const body = keyMatch[1];
    const keyNames = [...body.matchAll(/^\s*([a-zA-Z_]\w*)\s*:\s*\(/gm)].map((m) => m[1]);
    const tokenCalls = [...body.matchAll(/clinicScopeToken\(clinicScope\)/g)].length;
    if (keyNames.length === 0) {
      failures.push('dashboardKeys contains no key factories');
    }
    if (tokenCalls < keyNames.length) {
      failures.push(
        `clinic scope token usage mismatch: key factories=${keyNames.length}, clinicScopeToken calls=${tokenCalls}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error('✗ dashboard query-key clinic scope guard failed');
    console.error(`  file: ${relative(ROOT, QUERY_KEYS_FILE)}`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log('✓ dashboard query-key clinic scope guard passed.');
  console.log(`  file: ${relative(ROOT, QUERY_KEYS_FILE)}`);
}

main();
