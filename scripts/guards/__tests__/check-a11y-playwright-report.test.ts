import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-a11y-playwright-report';

const TMP_BASE = join(tmpdir(), 'check-a11y-playwright-report-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeReport(name: string, report: unknown): string {
  const path = join(TMP_BASE, `${name}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf8');
  return path;
}

function buildSpec(file: string, status: string) {
  return {
    file,
    specs: [
      {
        file,
        tests: [
          {
            results: [{ status }],
          },
        ],
      },
    ],
    suites: [],
  };
}

describe('check-a11y-playwright-report', () => {
  it('passes when all required files have at least one executed non-skipped test', () => {
    const reportPath = writeReport('pass', {
      suites: [
        buildSpec('accessibility/login.a11y.spec.ts', 'passed'),
        buildSpec('accessibility/patientList.a11y.spec.ts', 'passed'),
        buildSpec('accessibility/patientDetail.a11y.spec.ts', 'passed'),
        buildSpec('accessibility/topLevelRoutes.a11y.spec.ts', 'passed'),
      ],
    });
    const result = runGuard({ reportPath });
    expect(result.exitCode).toBe(0);
  });

  it('fails when a required file is missing', () => {
    const reportPath = writeReport('missing', {
      suites: [
        buildSpec('accessibility/login.a11y.spec.ts', 'passed'),
        buildSpec('accessibility/patientList.a11y.spec.ts', 'passed'),
        buildSpec('accessibility/patientDetail.a11y.spec.ts', 'passed'),
      ],
    });
    const result = runGuard({ reportPath });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('missing from Playwright report'))).toBe(true);
  });

  it('fails when required file only has skipped tests', () => {
    const reportPath = writeReport('skipped', {
      suites: [
        buildSpec('accessibility/login.a11y.spec.ts', 'passed'),
        buildSpec('accessibility/patientList.a11y.spec.ts', 'passed'),
        buildSpec('accessibility/patientDetail.a11y.spec.ts', 'passed'),
        buildSpec('accessibility/topLevelRoutes.a11y.spec.ts', 'skipped'),
      ],
    });
    const result = runGuard({ reportPath });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('skipped test'))).toBe(true);
  });
});

