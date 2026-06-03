import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TMP_BASE = join(tmpdir(), 'check-a2-not-null-readiness-fixtures');
const SCRIPT = join(process.cwd(), 'scripts', 'guards', 'check-a2-not-null-readiness.ts');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

type FixtureOpts = {
  allowNotNullEnforcement?: boolean;
  bug315Backfill?: 'pending' | 'in_progress' | 'complete';
  bug315Readiness?: 'pending' | 'verified';
  bug334Backfill?: 'pending' | 'in_progress' | 'complete';
  bug334Readiness?: 'pending' | 'verified';
  mutateManifest?: (manifest: Record<string, unknown>) => void;
  migrationBody?: string;
};

function writeFixture(name: string, opts: FixtureOpts = {}): { manifestPath: string; migrationsDir: string } {
  const dir = join(TMP_BASE, name);
  const migrationsDir = join(dir, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });

  const manifest: Record<string, unknown> = {
    version: 1,
    lane: 'A2',
    slice: 'A2-2',
    updatedAt: '2026-05-11',
    allowNotNullEnforcement: opts.allowNotNullEnforcement ?? false,
    targets: [
      {
        bugId: 'BUG-315',
        table: 'clinical_notes',
        column: 'consent_id',
        backfillStatus: opts.bug315Backfill ?? 'in_progress',
        backfillEvidence: 'docs/evidence/bug-315.md',
        appReadinessStatus: opts.bug315Readiness ?? 'pending',
        appReadinessEvidence: 'docs/evidence/bug-315-readiness.md',
      },
      {
        bugId: 'BUG-334',
        table: 'clinics',
        column: 'hpio',
        backfillStatus: opts.bug334Backfill ?? 'in_progress',
        backfillEvidence: 'docs/evidence/bug-334.md',
        appReadinessStatus: opts.bug334Readiness ?? 'pending',
        appReadinessEvidence: 'docs/evidence/bug-334-readiness.md',
      },
    ],
  };

  opts.mutateManifest?.(manifest);

  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const migrationBody = opts.migrationBody ?? `
    import { Knex } from 'knex';
    export async function up(_knex: Knex): Promise<void> {}
    export async function down(_knex: Knex): Promise<void> {}
  `;
  writeFileSync(join(migrationsDir, '20260101000000_fixture.ts'), migrationBody, 'utf8');

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
    const stdout = error instanceof Error && 'stdout' in error ? String((error as { stdout?: string }).stdout ?? '') : '';
    const stderr = error instanceof Error && 'stderr' in error ? String((error as { stderr?: string }).stderr ?? '') : '';
    return { ok: false, output: `${stdout}\n${stderr}` };
  }
}

describe('check-a2-not-null-readiness', () => {
  it('passes Phase A manifest with no NOT NULL enforcement', () => {
    const fx = writeFixture('pass-phase-a');
    const res = runGuard(fx.manifestPath, fx.migrationsDir);
    expect(res.ok).toBe(true);
    expect(res.output).toContain('✓ check-a2-not-null-readiness');
  });

  it('fails if NOT NULL enforcement appears while allowNotNullEnforcement=false', () => {
    const fx = writeFixture('fail-premature-enforcement', {
      migrationBody: `
        import { Knex } from 'knex';
        export async function up(knex: Knex): Promise<void> {
          await knex.schema.alterTable('clinical_notes', (t) => {
            t.dropNullable('consent_id');
          });
        }
        export async function down(_knex: Knex): Promise<void> {}
      `,
    });
    const res = runGuard(fx.manifestPath, fx.migrationsDir);
    expect(res.ok).toBe(false);
    expect(res.output).toContain('premature NOT NULL enforcement detected');
  });

  it('fails if manifest is missing one required target', () => {
    const fx = writeFixture('fail-missing-target', {
      mutateManifest: (manifest) => {
        manifest.targets = [
          {
            bugId: 'BUG-315',
            table: 'clinical_notes',
            column: 'consent_id',
            backfillStatus: 'in_progress',
            backfillEvidence: 'docs/evidence/bug-315.md',
            appReadinessStatus: 'pending',
            appReadinessEvidence: 'docs/evidence/bug-315-readiness.md',
          },
        ];
      },
    });
    const res = runGuard(fx.manifestPath, fx.migrationsDir);
    expect(res.ok).toBe(false);
    expect(res.output).toContain('targets must contain exactly 2 entries');
  });

  it('passes enforcement only when manifest is fully verified', () => {
    const fx = writeFixture('pass-enforcement-verified', {
      allowNotNullEnforcement: true,
      bug315Backfill: 'complete',
      bug315Readiness: 'verified',
      bug334Backfill: 'complete',
      bug334Readiness: 'verified',
      migrationBody: `
        import { Knex } from 'knex';
        export async function up(knex: Knex): Promise<void> {
          await knex.raw('ALTER TABLE clinics ALTER COLUMN hpio SET NOT NULL');
        }
        export async function down(_knex: Knex): Promise<void> {}
      `,
    });
    const res = runGuard(fx.manifestPath, fx.migrationsDir);
    expect(res.ok).toBe(true);
    expect(res.output).toContain('allowNotNullEnforcement: true');
  });
});
