import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-canonical-persona-seed-singleton';

const TMP_BASE = join(tmpdir(), 'check-canonical-persona-seed-singleton-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixtureSet(name: string, fixtureSource: string, helpersSource: string, extra?: string): {
  fixturePath: string;
  helpersPath: string;
  testsRoot: string;
} {
  const root = join(TMP_BASE, name, 'tests');
  const fixturesDir = join(root, 'fixtures');
  const integrationDir = join(root, 'integration');
  mkdirSync(fixturesDir, { recursive: true });
  mkdirSync(integrationDir, { recursive: true });

  const fixturePath = join(fixturesDir, 'canonical-personas.ts');
  const helpersPath = join(integrationDir, '_helpers.ts');
  writeFileSync(fixturePath, fixtureSource, 'utf8');
  writeFileSync(helpersPath, helpersSource, 'utf8');

  if (extra) {
    writeFileSync(join(root, 'extra.ts'), extra, 'utf8');
  }

  return { fixturePath, helpersPath, testsRoot: root };
}

describe('check-canonical-persona-seed-singleton', () => {
  it('passes when fixture is canonical singleton and helpers import it', () => {
    const paths = writeFixtureSet(
      'pass',
      `
export const CANONICAL_PASSWORD = 'Password1!';
export const CANONICAL_PERSONAS = { superadmin: { email: 'admin@signacare.local' } };
`,
      `
import { CANONICAL_PASSWORD, CANONICAL_PERSONAS } from '../fixtures/canonical-personas';
export const TEST_ADMIN_EMAIL = CANONICAL_PERSONAS.superadmin.email;
export const TEST_ADMIN_PASSWORD = CANONICAL_PASSWORD;
`,
    );

    const result = runGuard(paths);
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when helpers hardcode admin credentials', () => {
    const paths = writeFixtureSet(
      'hardcoded',
      `
export const CANONICAL_PASSWORD = 'Password1!';
export const CANONICAL_PERSONAS = { superadmin: { email: 'admin@signacare.local' } };
`,
      `
export const TEST_ADMIN_EMAIL = 'admin@signacare.local';
export const TEST_ADMIN_PASSWORD = 'Password1!';
`,
    );

    const result = runGuard(paths);
    expect(result.exitCode).toBe(1);
    expect(
      result.violations.some((v) => v.reason.includes('must import canonical personas fixture')),
    ).toBe(true);
    expect(
      result.violations.some((v) => v.reason.includes('TEST_ADMIN_EMAIL must reference')),
    ).toBe(true);
    expect(
      result.violations.some((v) => v.reason.includes('TEST_ADMIN_PASSWORD must reference')),
    ).toBe(true);
  });

  it('fails when multiple CANONICAL_PERSONAS exports exist', () => {
    const paths = writeFixtureSet(
      'duplicate',
      `
export const CANONICAL_PASSWORD = 'Password1!';
export const CANONICAL_PERSONAS = { superadmin: { email: 'admin@signacare.local' } };
`,
      `
import { CANONICAL_PASSWORD, CANONICAL_PERSONAS } from '../fixtures/canonical-personas';
export const TEST_ADMIN_EMAIL = CANONICAL_PERSONAS.superadmin.email;
export const TEST_ADMIN_PASSWORD = CANONICAL_PASSWORD;
`,
      `export const CANONICAL_PERSONAS = {};`,
    );

    const result = runGuard(paths);
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('expected exactly one'))).toBe(true);
  });
});
