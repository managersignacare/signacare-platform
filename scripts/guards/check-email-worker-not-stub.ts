#!/usr/bin/env tsx
/**
 * Structural guard (M2/M5): email worker must not regress to a stub.
 *
 * Fails if apps/api/src/jobs/workers/emailWorker.ts contains the
 * historical stub marker or a no-op export-only body.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const TARGET = resolve(ROOT, 'apps', 'api', 'src', 'jobs', 'workers', 'emailWorker.ts');

function main(): number {
  let src = '';
  try {
    src = readFileSync(TARGET, 'utf8');
  } catch (err) {
    console.error(`check-email-worker-not-stub: failed to read ${TARGET}: ${(err as Error).message}`);
    return 1;
  }

  if (/Stub\s+—\s+worker\s+not\s+yet\s+implemented/i.test(src)) {
    console.error('check-email-worker-not-stub: FAIL — stub marker found in emailWorker.ts');
    return 1;
  }

  const stripped = src
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  if (stripped === 'export {};' || stripped === 'export{};') {
    console.error('check-email-worker-not-stub: FAIL — no-op export-only worker detected');
    return 1;
  }

  console.log('check-email-worker-not-stub: PASS');
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
