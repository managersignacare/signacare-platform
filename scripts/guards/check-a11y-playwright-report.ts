#!/usr/bin/env tsx
/**
 * C3-1 guard: required a11y specs must execute with non-zero, non-skipped runs.
 */

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_REPORT_PATH = resolve(ROOT, 'a11y-playwright-report.json');

const REQUIRED_FILES = [
  'accessibility/login.a11y.spec.ts',
  'accessibility/patientList.a11y.spec.ts',
  'accessibility/patientDetail.a11y.spec.ts',
  'accessibility/topLevelRoutes.a11y.spec.ts',
];

interface PlaywrightResult {
  status?: string;
}

interface PlaywrightTestCase {
  results?: PlaywrightResult[];
}

interface PlaywrightSpec {
  file?: string;
  tests?: PlaywrightTestCase[];
}

interface PlaywrightSuite {
  file?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightReport {
  suites?: PlaywrightSuite[];
}

interface FileExecution {
  executed: number;
  skipped: number;
  withNoAttempts: number;
}

export interface Violation {
  reason: string;
}

export interface RunGuardOpts {
  reportPath?: string;
}

export interface RunGuardResult {
  exitCode: 0 | 1;
  violations: Violation[];
  perFile: Record<string, FileExecution>;
}

function normalizeFilePath(pathValue: string | undefined): string {
  if (!pathValue) return '';
  return pathValue.replace(/\\/g, '/').replace(/^e2e\//, '');
}

function collectSpecs(suites: PlaywrightSuite[], out: PlaywrightSpec[] = []): PlaywrightSpec[] {
  for (const suite of suites) {
    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        if (!spec.file && suite.file) {
          spec.file = suite.file;
        }
        out.push(spec);
      }
    }
    if (Array.isArray(suite.suites)) collectSpecs(suite.suites, out);
  }
  return out;
}

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const reportPath = opts.reportPath ?? DEFAULT_REPORT_PATH;
  const reportRelPath = relative(ROOT, reportPath);
  const violations: Violation[] = [];
  const perFile: Record<string, FileExecution> = {};

  let report: PlaywrightReport | null = null;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8')) as PlaywrightReport;
  } catch (error) {
    return {
      exitCode: 1,
      violations: [
        {
          reason: `${reportRelPath}: invalid/missing Playwright JSON report (${error instanceof Error ? error.message : String(error)})`,
        },
      ],
      perFile,
    };
  }

  const suites = report.suites ?? [];
  const specs = collectSpecs(suites);
  for (const spec of specs) {
    const file = normalizeFilePath(spec.file);
    if (!file) continue;
    const row = (perFile[file] ??= { executed: 0, skipped: 0, withNoAttempts: 0 });
    for (const testCase of spec.tests ?? []) {
      const attempts = testCase.results ?? [];
      if (attempts.length === 0) {
        row.withNoAttempts += 1;
        continue;
      }
      const finalStatus = attempts[attempts.length - 1]?.status ?? 'unknown';
      if (finalStatus === 'skipped') row.skipped += 1;
      else row.executed += 1;
    }
  }

  for (const file of REQUIRED_FILES) {
    const row = perFile[file];
    if (!row) {
      violations.push({ reason: `${file}: missing from Playwright report` });
      continue;
    }
    if (row.executed === 0) {
      violations.push({ reason: `${file}: zero executed tests (false-green risk)` });
    }
    if (row.skipped > 0) {
      violations.push({ reason: `${file}: ${row.skipped} skipped test(s) in required a11y surface` });
    }
    if (row.withNoAttempts > 0) {
      violations.push({ reason: `${file}: ${row.withNoAttempts} test(s) had zero attempts` });
    }
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    violations,
    perFile,
  };
}

function main(): number {
  const reportPath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : DEFAULT_REPORT_PATH;
  console.log('→ check-a11y-playwright-report');
  const result = runGuard({ reportPath });
  console.log(`  violations: ${result.violations.length}`);
  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.log(`  - ${violation.reason}`);
    }
    return 1;
  }
  console.log('✓ Required a11y specs executed with non-zero, non-skipped results.');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

