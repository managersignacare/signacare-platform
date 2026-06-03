/**
 * BUG-PR-R1-12-FIX-S1-mha_reviews regression.
 *
 * S1 clinical-safety class: statutory-review concurrency. No feature-
 * level handler exists today (table is INSERT-only via seed scripts);
 * column is preventive enforcement so any future UPDATE author MUST
 * route through updateWithOptimisticLock per CLAUDE.md §1.6.
 *
 * Coverage (2 tests):
 *   T1 — DB column NOT NULL DEFAULT 1
 *   T2 — CLAUDE.md §1.6 roster lists mha_reviews
 */

import { describe, it, expect } from 'vitest';
import { isIntegrationReady } from './_helpers';

describe.skipIf(!(await isIntegrationReady()))('BUG-PR-R1-12-FIX-S1-mha_reviews opt-locking', () => {
  it('T1: DB column lock_version NOT NULL DEFAULT 1', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const meta = await dbAdmin.raw(
      `SELECT column_name, is_nullable, column_default, data_type
       FROM information_schema.columns
       WHERE table_name = 'mha_reviews' AND column_name = 'lock_version'`,
    );
    const row = meta.rows?.[0] as
      | { column_name: string; is_nullable: string; column_default: string; data_type: string }
      | undefined;
    expect(row).toBeTruthy();
    expect(row!.is_nullable).toBe('NO');
    expect(row!.column_default).toMatch(/^1\b/);
    expect(row!.data_type).toBe('integer');
  });

  it('T2: CLAUDE.md §1.6 roster lists mha_reviews', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const claudeMd = readFileSync(resolve(repoRoot, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toMatch(/mha_reviews.*BUG-PR-R1-12-FIX-S1-mha_reviews/);
  });
});
