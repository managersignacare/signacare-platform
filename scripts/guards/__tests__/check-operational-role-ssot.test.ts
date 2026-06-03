import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TMP_BASE = join(tmpdir(), 'check-operational-role-ssot-fixtures');
const SCRIPT = join(process.cwd(), 'scripts', 'guards', 'check-operational-role-ssot.ts');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

interface FixtureOptions {
  tsRoles?: string[];
  trackedFileOverride?: Partial<Record<string, string>>;
  extraUntrackedFileBody?: string;
}

function writeFixture(name: string, opts: FixtureOptions = {}): { manifestPath: string; migrationsDir: string } {
  const dir = join(TMP_BASE, name);
  const migrationsDir = join(dir, 'migrations');
  const sharedDir = join(dir, 'packages', 'shared', 'src');
  mkdirSync(migrationsDir, { recursive: true });
  mkdirSync(sharedDir, { recursive: true });

  const roles = opts.tsRoles ?? ['receptionist', 'readonly'];
  const roleLiteral = roles.map((r) => `'${r}'`).join(', ');
  writeFileSync(
    join(sharedDir, 'permissions.ts'),
    `export const OPERATIONAL_ONLY: ReadonlySet<string> = new Set([${roleLiteral}]);\n`,
    'utf8',
  );

  const trackedNames = [
    '20260423000005_access_admin_slot_integrity_trigger.ts',
    '20260423000007_access_admin_trigger_audit_log.ts',
    '20260423000008_reconcile_stale_admin_slots.ts',
  ];

  for (const file of trackedNames) {
    const body =
      opts.trackedFileOverride?.[file] ??
      `
      export const sql = \`
        SELECT 1
        FROM staff
        WHERE role IN ('receptionist','readonly')
      \`;
      `;
    writeFileSync(join(migrationsDir, file), body, 'utf8');
  }

  if (opts.extraUntrackedFileBody) {
    writeFileSync(
      join(migrationsDir, '20269999000000_untracked_fixture.ts'),
      opts.extraUntrackedFileBody,
      'utf8',
    );
  }

  const manifestPath = join(dir, 'operational-role-ssot.json');
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        lane: 'A2',
        bugId: 'BUG-355',
        updatedAt: '2026-05-12',
        tsSourcePath: join(sharedDir, 'permissions.ts'),
        tsExportName: 'OPERATIONAL_ONLY',
        trackedSqlFiles: trackedNames.map((nameValue) => join(migrationsDir, nameValue)),
        roleListPattern: 'role\\s+IN\\s*\\(([^)]*)\\)',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return { manifestPath, migrationsDir };
}

function runGuard(manifestPath: string, migrationsDir: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync(
      'npx',
      ['tsx', SCRIPT, manifestPath, migrationsDir],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return { ok: true, output };
  } catch (error) {
    const stdout =
      error instanceof Error && 'stdout' in error ? String((error as { stdout?: string }).stdout ?? '') : '';
    const stderr =
      error instanceof Error && 'stderr' in error ? String((error as { stderr?: string }).stderr ?? '') : '';
    return { ok: false, output: `${stdout}\n${stderr}` };
  }
}

describe('check-operational-role-ssot', () => {
  it('passes when tracked SQL role lists exactly match TS OPERATIONAL_ONLY', () => {
    const fx = writeFixture('pass');
    const res = runGuard(fx.manifestPath, fx.migrationsDir);
    expect(res.ok).toBe(true);
    expect(res.output).toContain('✓ check-operational-role-ssot');
  });

  it('fails when a tracked SQL role list drifts from TS OPERATIONAL_ONLY', () => {
    const fx = writeFixture('fail-mismatch', {
      trackedFileOverride: {
        '20260423000007_access_admin_trigger_audit_log.ts': `
          export const sql = \`
            SELECT 1
            FROM staff
            WHERE role IN ('receptionist','readonly','admin')
          \`;
        `,
      },
    });
    const res = runGuard(fx.manifestPath, fx.migrationsDir);
    expect(res.ok).toBe(false);
    expect(res.output).toContain('SQL/TS operational-role mismatch');
  });

  it('fails when an untracked migration introduces an operational-role literal', () => {
    const fx = writeFixture('fail-untracked', {
      extraUntrackedFileBody: `
        export const sql = \`
          SELECT 1
          FROM staff
          WHERE role IN ('receptionist','readonly')
        \`;
      `,
    });
    const res = runGuard(fx.manifestPath, fx.migrationsDir);
    expect(res.ok).toBe(false);
    expect(res.output).toContain('untracked operational-role SQL literal');
  });
});
