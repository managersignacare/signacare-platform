/**
 * BUG-PR-R1-12-FIX-S1-clinical_note_evidence regression.
 *
 * S1 clinical-safety class: evidence-link concurrency. No feature-level
 * handler exists today; column is preventive enforcement per CLAUDE.md §1.6.
 *
 * Coverage (2 tests):
 *   T1 — DB column NOT NULL DEFAULT 1
 *   T2 — CLAUDE.md §1.6 roster lists clinical_note_evidence
 */

import { describe, it, expect } from 'vitest';
import { isIntegrationReady } from './_helpers';

describe.skipIf(!(await isIntegrationReady()))('BUG-PR-R1-12-FIX-S1-clinical_note_evidence opt-locking', () => {
  it('T1: DB column lock_version NOT NULL DEFAULT 1', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const meta = await dbAdmin.raw(
      `SELECT column_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'clinical_note_evidence' AND column_name = 'lock_version'`,
    );
    const row = meta.rows?.[0] as { is_nullable: string; column_default: string } | undefined;
    expect(row).toBeTruthy();
    expect(row!.is_nullable).toBe('NO');
    expect(row!.column_default).toMatch(/^1\b/);
  });

  it('T2: CLAUDE.md §1.6 roster lists clinical_note_evidence', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const claudeMd = readFileSync(resolve(repoRoot, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toMatch(/clinical_note_evidence.*BUG-PR-R1-12-FIX-S1-clinical_note_evidence/);
  });
});
