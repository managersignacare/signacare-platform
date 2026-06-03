#!/usr/bin/env tsx
/**
 * Guard: targeted limiter reset must stay targeted.
 *
 * Disallow wildcard limiter clears (`rl:*`) inside runtime feature code.
 * Broad reset is allowed only in controlled maintenance/bootstrap paths,
 * not in operational request handlers.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const FEATURE_ROOT = resolve(ROOT, 'apps', 'api', 'src', 'features');

const WILDCARD_PATTERNS: RegExp[] = [
  /redis\.(keys|scan)\(\s*['"`]rl:\*/i,
  /['"`]MATCH['"`]\s*,\s*['"`]rl:\*/i,
];

function main(): number {
  const files = collectTypeScriptFiles(FEATURE_ROOT)
    .map((abs) => abs.replace(`${ROOT}/`, ''));
  const violations: Array<{ file: string; pattern: string }> = [];

  for (const rel of files) {
    const abs = resolve(ROOT, rel);
    const src = readFileSync(abs, 'utf8');
    for (const rx of WILDCARD_PATTERNS) {
      if (rx.test(src)) {
        violations.push({ file: rel, pattern: rx.source });
      }
    }
  }

  if (violations.length > 0) {
    console.error('check-targeted-limiter-reset-scope: FAIL');
    for (const v of violations) {
      console.error(`  - ${v.file} matched /${v.pattern}/`);
    }
    return 1;
  }

  console.log('check-targeted-limiter-reset-scope: PASS');
  return 0;
}

function collectTypeScriptFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile() && abs.endsWith('.ts')) {
        out.push(abs);
      }
    }
  }
  return out;
}

if (require.main === module) {
  process.exit(main());
}
