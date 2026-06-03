import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard } from '../check-dr-drill-asserts-fingerprint';

const TMP_BASE = join(tmpdir(), 'check-dr-drill-asserts-fingerprint-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixture(name: string, source: string): string {
  const path = join(TMP_BASE, name);
  writeFileSync(path, source, 'utf8');
  return path;
}

describe('check-dr-drill-asserts-fingerprint', () => {
  it('passes when drill enforces fingerprint + non-skip assertions', () => {
    const file = writeFixture(
      'pass.sh',
      `
EXPECTED_SCHEMA_FINGERPRINT_FILE="docs/quality/expected-schema-fingerprint.txt"
EXPECTED_SCHEMA_FINGERPRINT=""
echo "Expected DR schema fingerprint missing or invalid."
SOURCE_SCHEMA_FP="$(schema_fingerprint source)"
RESTORED_SCHEMA_FP="$(schema_fingerprint restored)"
echo "source schema fingerprint mismatch"
echo "restored schema fingerprint mismatch"
echo "source has zero rows"
echo "restored has zero rows"
echo "sample patient round-trip missing"
`,
    );

    const result = runGuard({ sourcePath: file });
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when skip-path or fingerprint checks are absent', () => {
    const file = writeFixture(
      'fail.sh',
      `
echo "all good"
echo "skipping round-trip assertion"
`,
    );
    const result = runGuard({ sourcePath: file });
    expect(result.exitCode).toBe(1);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(
      result.violations.some((v) => v.reason.includes('missing expected schema fingerprint')),
    ).toBe(true);
    expect(
      result.violations.some((v) => v.reason.includes('contains skip path for sample-patient')),
    ).toBe(true);
  });
});
