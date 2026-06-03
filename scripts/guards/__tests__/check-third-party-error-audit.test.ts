import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-third-party-error-audit';

const TMP_BASE = join(tmpdir(), 'bug313-third-party-error-audit-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixtureFile(root: string, relPath: string, content: string): void {
  const fullPath = join(root, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

function fixtureRoot(name: string): string {
  const root = join(TMP_BASE, name);
  mkdirSync(root, { recursive: true });
  return root;
}

describe('check-third-party-error-audit guard', () => {
  it('passes when worker logs pass raw err objects', () => {
    const root = fixtureRoot('pass');
    writeFixtureFile(
      root,
      'apps/api/src/jobs/workers/sampleWorker.ts',
      `import { logger } from '../../utils/logger';
export function f(err: Error) {
  logger.error({ err, jobId: '1' }, 'worker failed');
}`,
    );

    const result = runGuard(root);
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when logger metadata uses err.message', () => {
    const root = fixtureRoot('metadata_fail');
    writeFixtureFile(
      root,
      'apps/api/src/jobs/workers/sampleWorker.ts',
      `import { logger } from '../../utils/logger';
export function f(err: Error) {
  logger.error({ err: err.message, jobId: '1' }, 'worker failed');
}`,
    );

    const result = runGuard(root);
    expect(result.exitCode).toBe(1);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('fails when logger message interpolates err.message', () => {
    const root = fixtureRoot('template_fail');
    writeFixtureFile(
      root,
      'apps/api/src/queues/sampleQueue.ts',
      `import { logger } from '../utils/logger';
export function f(err: Error) {
  logger.error({ jobId: '1' }, \`queue failed: \${err.message}\`);
}`,
    );

    const result = runGuard(root);
    expect(result.exitCode).toBe(1);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});
