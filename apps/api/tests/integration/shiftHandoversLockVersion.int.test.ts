/**
 * BUG-PR-R1-12-FIX-S1-shift_handovers regression.
 *
 * S1 clinical-safety class: handover concurrency (AHPRA Standard 6).
 * Multi-nurse PATCH wired through updateWithOptimisticLock with REQUIRED
 * expectedLockVersion at Zod boundary.
 *
 * Coverage (3 tests):
 *   T1 — DB column NOT NULL DEFAULT 1
 *   T2 — ShiftHandoverPatchSchema requires expectedLockVersion (source-level)
 *   T3 — CLAUDE.md §1.6 roster lists shift_handovers
 */

import { describe, it, expect } from 'vitest';
import { isIntegrationReady } from './_helpers';

describe.skipIf(!(await isIntegrationReady()))('BUG-PR-R1-12-FIX-S1-shift_handovers opt-locking', () => {
  it('T1: DB column lock_version NOT NULL DEFAULT 1', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const meta = await dbAdmin.raw(
      `SELECT column_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'shift_handovers' AND column_name = 'lock_version'`,
    );
    const row = meta.rows?.[0] as { is_nullable: string; column_default: string } | undefined;
    expect(row).toBeTruthy();
    expect(row!.is_nullable).toBe('NO');
    expect(row!.column_default).toMatch(/^1\b/);
  });

  it('T2: ShiftHandoverPatchSchema requires expectedLockVersion (source-level)', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'roles', 'nurseFeatureRoutes.ts'),
      'utf-8',
    );
    const schemaIdx = src.indexOf('ShiftHandoverPatchSchema = z.object');
    expect(schemaIdx).toBeGreaterThan(-1);
    const schemaBlock = src.slice(schemaIdx, schemaIdx + 600);
    expect(schemaBlock).toMatch(/expectedLockVersion: z\.number\(\)\.int\(\)\.positive\(\)/);
  });

  it('T3: CLAUDE.md §1.6 roster lists shift_handovers', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const claudeMd = readFileSync(resolve(repoRoot, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toMatch(/shift_handovers.*BUG-PR-R1-12-FIX-S1-shift_handovers/);
  });
});
