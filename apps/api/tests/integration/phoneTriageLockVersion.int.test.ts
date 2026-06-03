/**
 * BUG-PR-R1-12-FIX-S1-phone_triage regression.
 *
 * S1 clinical-safety class: triage decision concurrency. Two UPDATE paths
 * (receptionist PUT + nurse PATCH /clinical-triage) wired through the
 * helper with REQUIRED expectedLockVersion.
 *
 * Coverage (4 tests):
 *   T1 — DB column NOT NULL DEFAULT 1
 *   T2 — NurseTriagePatchSchema requires expectedLockVersion
 *   T3 — ReceptionistTriageUpdateSchema requires expectedLockVersion
 *   T4 — CLAUDE.md §1.6 roster lists phone_triage
 */

import { describe, it, expect } from 'vitest';
import { isIntegrationReady } from './_helpers';

describe.skipIf(!(await isIntegrationReady()))('BUG-PR-R1-12-FIX-S1-phone_triage opt-locking', () => {
  it('T1: DB column lock_version NOT NULL DEFAULT 1', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const meta = await dbAdmin.raw(
      `SELECT column_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'phone_triage' AND column_name = 'lock_version'`,
    );
    const row = meta.rows?.[0] as { is_nullable: string; column_default: string } | undefined;
    expect(row).toBeTruthy();
    expect(row!.is_nullable).toBe('NO');
    expect(row!.column_default).toMatch(/^1\b/);
  });

  it('T2: NurseTriagePatchSchema requires expectedLockVersion (source-level)', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'roles', 'nurseFeatureRoutes.ts'),
      'utf-8',
    );
    const schemaIdx = src.indexOf('NurseTriagePatchSchema = z.object');
    expect(schemaIdx).toBeGreaterThan(-1);
    const schemaBlock = src.slice(schemaIdx, schemaIdx + 600);
    expect(schemaBlock).toMatch(/expectedLockVersion: z\.number\(\)\.int\(\)\.positive\(\)/);
  });

  it('T3: ReceptionistTriageUpdateSchema requires expectedLockVersion (source-level)', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'roles', 'receptionistFeatureRoutes.ts'),
      'utf-8',
    );
    const schemaIdx = src.indexOf('ReceptionistTriageUpdateSchema = z.object');
    expect(schemaIdx).toBeGreaterThan(-1);
    const schemaBlock = src.slice(schemaIdx, schemaIdx + 600);
    expect(schemaBlock).toMatch(/expectedLockVersion: z\.number\(\)\.int\(\)\.positive\(\)/);
  });

  it('T4: CLAUDE.md §1.6 roster lists phone_triage', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const claudeMd = readFileSync(resolve(repoRoot, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toMatch(/phone_triage.*BUG-PR-R1-12-FIX-S1-phone_triage/);
  });
});
