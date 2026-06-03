/**
 * BUG-PR-R1-12-FIX-S1-clinical_note_codes regression.
 *
 * S1 clinical-safety class: coded-diagnoses concurrency. Multiple
 * clinicians may concurrently accept/reject the same AI-suggested
 * ICD-10 code; opt-locked through updateWithOptimisticLock.
 *
 * Coverage (3 tests):
 *   T1 — DB column NOT NULL DEFAULT 1
 *   T2 — UpdateCodeBodySchema requires expectedLockVersion
 *        (source-level pin)
 *   T3 — updateCode handler routes through updateWithOptimisticLock
 *        (source-level pin)
 */

import { describe, it, expect } from 'vitest';
import { isIntegrationReady } from './_helpers';

describe.skipIf(!(await isIntegrationReady()))('BUG-PR-R1-12-FIX-S1-clinical_note_codes opt-locking', () => {
  it('T1: DB column lock_version NOT NULL DEFAULT 1', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const meta = await dbAdmin.raw(
      `SELECT column_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'clinical_note_codes' AND column_name = 'lock_version'`,
    );
    const row = meta.rows?.[0] as { is_nullable: string; column_default: string } | undefined;
    expect(row).toBeTruthy();
    expect(row!.is_nullable).toBe('NO');
    expect(row!.column_default).toMatch(/^1\b/);
  });

  it('T2: UpdateCodeBodySchema requires expectedLockVersion (source-level)', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'clinical-notes', 'clinicalNote.controller.ts'),
      'utf-8',
    );
    const schemaIdx = src.indexOf('UpdateCodeBodySchema = z.object');
    expect(schemaIdx).toBeGreaterThan(-1);
    const schemaBlock = src.slice(schemaIdx, schemaIdx + 600);
    expect(schemaBlock).toMatch(/expectedLockVersion: z\.number\(\)\.int\(\)\.positive\(\)/);
  });

  it('T3: updateCode handler routes through updateWithOptimisticLock', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'clinical-notes', 'clinicalNote.controller.ts'),
      'utf-8',
    );
    const handlerIdx = src.indexOf('async updateCode(');
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerBlock = src.slice(handlerIdx, handlerIdx + 3000);
    expect(handlerBlock).toMatch(/updateWithOptimisticLock/);
    expect(handlerBlock).toMatch(/BUG-PR-R1-12-FIX-S1-clinical_note_codes/);
  });
});
