import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-a11y-baseline-allowlist';

const TMP_BASE = join(tmpdir(), 'check-a11y-baseline-allowlist-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixture(
  name: string,
  baselineSource: string,
  ledgerSource = '| BUG-450 | S2 | Live axe-core CI run | open | notes | — |\n',
): { baselinePath: string; ledgerPath: string } {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  const baselinePath = join(dir, 'baseline.json');
  const ledgerPath = join(dir, 'bugs.md');
  writeFileSync(baselinePath, baselineSource, 'utf8');
  writeFileSync(ledgerPath, ledgerSource, 'utf8');
  return { baselinePath, ledgerPath };
}

describe('check-a11y-baseline-allowlist', () => {
  it('passes for a valid mapped baseline entry', () => {
    const { baselinePath, ledgerPath } = writeFixture(
      'pass',
      JSON.stringify(
        {
          version: 1,
          generatedAt: '2026-05-11',
          sourceCommand: 'npx playwright test',
          entries: [
            {
              surface: '/login',
              impact: 'serious',
              ruleId: 'color-contrast',
              bugId: 'BUG-450',
              expiresOn: '2026-12-31',
              reason: 'Known debt',
            },
          ],
        },
        null,
        2,
      ),
    );
    const result = runGuard({ baselinePath, bugLedgerPath: ledgerPath });
    expect(result.exitCode).toBe(0);
  });

  it('fails when bug ID is missing from bug ledger', () => {
    const { baselinePath, ledgerPath } = writeFixture(
      'unknown-bug',
      JSON.stringify(
        {
          version: 1,
          generatedAt: '2026-05-11',
          sourceCommand: 'npx playwright test',
          entries: [
            {
              surface: '/login',
              impact: 'serious',
              ruleId: 'color-contrast',
              bugId: 'BUG-999',
              expiresOn: '2026-12-31',
              reason: 'Known debt',
            },
          ],
        },
        null,
        2,
      ),
    );
    const result = runGuard({ baselinePath, bugLedgerPath: ledgerPath });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('not found'))).toBe(true);
  });

  it('fails when expiry is in the past', () => {
    const { baselinePath, ledgerPath } = writeFixture(
      'expired',
      JSON.stringify(
        {
          version: 1,
          generatedAt: '2026-05-11',
          sourceCommand: 'npx playwright test',
          entries: [
            {
              surface: '/login',
              impact: 'serious',
              ruleId: 'color-contrast',
              bugId: 'BUG-450',
              expiresOn: '2020-01-01',
              reason: 'Known debt',
            },
          ],
        },
        null,
        2,
      ),
    );
    const result = runGuard({ baselinePath, bugLedgerPath: ledgerPath });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('in the past'))).toBe(true);
  });

  it('fails on duplicate suppression key', () => {
    const { baselinePath, ledgerPath } = writeFixture(
      'duplicate',
      JSON.stringify(
        {
          version: 1,
          generatedAt: '2026-05-11',
          sourceCommand: 'npx playwright test',
          entries: [
            {
              surface: '/login',
              impact: 'serious',
              ruleId: 'color-contrast',
              bugId: 'BUG-450',
              expiresOn: '2026-12-31',
              reason: 'Known debt',
            },
            {
              surface: '/login',
              impact: 'serious',
              ruleId: 'color-contrast',
              bugId: 'BUG-450',
              expiresOn: '2026-12-31',
              reason: 'Known debt duplicate',
            },
          ],
        },
        null,
        2,
      ),
    );
    const result = runGuard({ baselinePath, bugLedgerPath: ledgerPath });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('duplicate suppression key'))).toBe(true);
  });
});

