/**
 * BUG-PR-R1-12-FIX-S0-restrictive_interventions regression.
 *
 * S0 patient-harm class: MHA evidentiary corruption — concurrent "end
 * intervention" calls would silently overwrite duration_minutes /
 * debrief_notes / notified_persons. Sibling pattern of BUG-371b
 * (REQUIRED expectedLockVersion at the Zod boundary; high-harm posture).
 *
 * Coverage (5 tests):
 *   T1 — DB column exists with NOT NULL + DEFAULT 1
 *   T2 — Zod schema requires expectedLockVersion
 *   T3 — Zod schema rejects when expectedLockVersion missing
 *   T4 — RESTRICTIVE_INTERVENTION_COLUMNS array includes lock_version
 *   T5 — bedRoutes /end handler routes through updateWithOptimisticLock
 *        (source-level pin)
 */

import { describe, it, expect } from 'vitest';
import { isIntegrationReady } from './_helpers';

describe.skipIf(!(await isIntegrationReady()))('BUG-PR-R1-12-FIX-S0-restrictive_interventions opt-locking', () => {
  // ── T1 ──
  it('T1: DB column lock_version NOT NULL DEFAULT 1', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const meta = await dbAdmin.raw(
      `SELECT column_name, is_nullable, column_default, data_type
       FROM information_schema.columns
       WHERE table_name = 'restrictive_interventions' AND column_name = 'lock_version'`,
    );
    const row = meta.rows?.[0] as
      | { column_name: string; is_nullable: string; column_default: string; data_type: string }
      | undefined;
    expect(row).toBeTruthy();
    expect(row!.is_nullable).toBe('NO');
    expect(row!.column_default).toMatch(/^1\b/);
    expect(row!.data_type).toBe('integer');
  });

  // ── T2 ──
  it('T2: EndRestrictiveInterventionSchema accepts expectedLockVersion', async () => {
    const { EndRestrictiveInterventionSchema } = await import('@signacare/shared');
    const result = EndRestrictiveInterventionSchema.safeParse({
      expectedLockVersion: 3,
      outcome: 'patient calmed',
      debriefCompleted: true,
    });
    expect(result.success).toBe(true);
  });

  // ── T3 ──
  it('T3: EndRestrictiveInterventionSchema rejects missing expectedLockVersion', async () => {
    const { EndRestrictiveInterventionSchema } = await import('@signacare/shared');
    const result = EndRestrictiveInterventionSchema.safeParse({
      outcome: 'patient calmed',
      debriefCompleted: true,
    });
    expect(result.success).toBe(false);
  });

  // ── T4 ──
  it('T4: source-level — RESTRICTIVE_INTERVENTION_COLUMNS includes lock_version', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'beds', 'bedRoutes.ts'),
      'utf-8',
    );
    const arrIdx = src.indexOf('const RESTRICTIVE_INTERVENTION_COLUMNS = [');
    expect(arrIdx).toBeGreaterThan(-1);
    const arrEnd = src.indexOf('] as const;', arrIdx);
    const arrBlock = src.slice(arrIdx, arrEnd);
    expect(arrBlock).toMatch(/'lock_version'/);
  });

  // ── T5 ──
  it('T5: source-level — /end handler routes through updateWithOptimisticLock', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'beds', 'bedRoutes.ts'),
      'utf-8',
    );
    const endHandlerIdx = src.indexOf("'/restrictive-interventions/:id/end'");
    expect(endHandlerIdx).toBeGreaterThan(-1);
    const handlerBlock = src.slice(endHandlerIdx, endHandlerIdx + 2000);
    expect(handlerBlock).toMatch(/updateWithOptimisticLock/);
    expect(handlerBlock).toMatch(/expectedLockVersion: endBody\.expectedLockVersion/);
  });
});
