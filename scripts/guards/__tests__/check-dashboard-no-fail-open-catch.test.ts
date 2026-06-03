import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-dashboard-no-fail-open-catch';

const TMP = join(tmpdir(), 'check-dashboard-no-fail-open-catch');

beforeAll(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

describe('check-dashboard-no-fail-open-catch', () => {
  it('passes when dashboard files have no local catch fallback', () => {
    const page = join(TMP, 'DashboardPage.tsx');
    const bits = join(TMP, 'DashboardViewBits.tsx');
    writeFileSync(page, `const x = Promise.resolve(1);\nexport const ok = x;`, 'utf8');
    writeFileSync(bits, `async function load() { return 1; }\n`, 'utf8');

    const out = runGuard({
      repoRoot: '/',
      targets: [page, bits],
    });
    expect(out.violations).toHaveLength(0);
  });

  it('fails when dashboard files include .catch(', () => {
    const page = join(TMP, 'DashboardPage.tsx');
    writeFileSync(page, `const x = fetch('/api').catch(() => []);`, 'utf8');

    const out = runGuard({
      repoRoot: '/',
      targets: [page],
    });
    expect(out.violations).toHaveLength(1);
    expect(out.violations[0]?.line).toBe(1);
  });
});

