/**
 * BUG-PR-R1-12-FIX-S1-lai_given regression.
 *
 * S1 clinical-safety class: LAI administration audit concurrency.
 * INSERT-only repository today; preventive column enforcement so any
 * future UPDATE author MUST route through updateWithOptimisticLock.
 *
 * Coverage (3 tests):
 *   T1 — DB column NOT NULL DEFAULT 1
 *   T2 — Row interface declares lock_version
 *   T3 — CLAUDE.md §1.6 roster lists lai_given
 */

import { describe, it, expect } from 'vitest';
import { isIntegrationReady } from './_helpers';

describe.skipIf(!(await isIntegrationReady()))('BUG-PR-R1-12-FIX-S1-lai_given opt-locking', () => {
  it('T1: DB column lock_version NOT NULL DEFAULT 1', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const meta = await dbAdmin.raw(
      `SELECT column_name, is_nullable, column_default, data_type
       FROM information_schema.columns
       WHERE table_name = 'lai_given' AND column_name = 'lock_version'`,
    );
    const row = meta.rows?.[0] as
      | { column_name: string; is_nullable: string; column_default: string; data_type: string }
      | undefined;
    expect(row).toBeTruthy();
    expect(row!.is_nullable).toBe('NO');
    expect(row!.column_default).toMatch(/^1\b/);
  });

  it('T2: source-level — LaiGivenRow interface declares lock_version', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'lai', 'laiGivenRepository.ts'),
      'utf-8',
    );
    expect(src).toMatch(/lock_version: +number;/);
    expect(src).toMatch(/'lock_version'.*BUG-PR-R1-12-FIX-S1-lai_given/);
  });

  it('T3: CLAUDE.md §1.6 roster lists lai_given', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const claudeMd = readFileSync(resolve(repoRoot, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toMatch(/lai_given.*BUG-PR-R1-12-FIX-S1-lai_given/);
  });
});
