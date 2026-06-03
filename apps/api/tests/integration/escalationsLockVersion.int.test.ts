/**
 * BUG-PR-R1-12-FIX-S1-escalations regression.
 *
 * S1 clinical-safety class: ISBAR audit-trail concurrency. UPDATE paths
 * (update / resolve / addNote) wired through updateWithOptimisticLock
 * with REQUIRED expectedLockVersion at the Zod boundary. Acknowledge
 * keeps legacy posture per BUG-371c asymmetric (acknowledged_at idempotency
 * guard prevents the race).
 *
 * Coverage (5 tests):
 *   T1 — DB column NOT NULL DEFAULT 1
 *   T2 — UpdateEscalationSchema requires expectedLockVersion
 *   T3 — ResolveEscalationSchema requires expectedLockVersion
 *   T4 — AddEscalationNoteSchema requires expectedLockVersion
 *   T5 — Repository.addEvent routes through updateWithOptimisticLock
 *        when expectedLockVersion is provided (source-level pin)
 */

import { describe, it, expect } from 'vitest';
import { isIntegrationReady } from './_helpers';

describe.skipIf(!(await isIntegrationReady()))('BUG-PR-R1-12-FIX-S1-escalations opt-locking', () => {
  it('T1: DB column lock_version NOT NULL DEFAULT 1', async () => {
    const { dbAdmin } = await import('../../src/db/db');
    const meta = await dbAdmin.raw(
      `SELECT column_name, is_nullable, column_default, data_type
       FROM information_schema.columns
       WHERE table_name = 'escalations' AND column_name = 'lock_version'`,
    );
    const row = meta.rows?.[0] as
      | { column_name: string; is_nullable: string; column_default: string; data_type: string }
      | undefined;
    expect(row).toBeTruthy();
    expect(row!.is_nullable).toBe('NO');
    expect(row!.column_default).toMatch(/^1\b/);
    expect(row!.data_type).toBe('integer');
  });

  it('T2: UpdateEscalationSchema requires expectedLockVersion', async () => {
    const { UpdateEscalationSchema } = await import('@signacare/shared');
    expect(UpdateEscalationSchema.safeParse({ assignedTeam: 'crisis' }).success).toBe(false);
    expect(UpdateEscalationSchema.safeParse({ expectedLockVersion: 1, assignedTeam: 'crisis' }).success).toBe(true);
  });

  it('T3: ResolveEscalationSchema requires expectedLockVersion', async () => {
    const { ResolveEscalationSchema } = await import('@signacare/shared');
    expect(ResolveEscalationSchema.safeParse({ notes: 'resolved' }).success).toBe(false);
    expect(ResolveEscalationSchema.safeParse({ expectedLockVersion: 1, notes: 'resolved' }).success).toBe(true);
  });

  it('T4: AddEscalationNoteSchema requires expectedLockVersion', async () => {
    const { AddEscalationNoteSchema } = await import('@signacare/shared');
    expect(AddEscalationNoteSchema.safeParse({ notes: 'follow-up' }).success).toBe(false);
    expect(AddEscalationNoteSchema.safeParse({ expectedLockVersion: 1, notes: 'follow-up' }).success).toBe(true);
  });

  it('T5: source-level — repository.addEvent routes through updateWithOptimisticLock', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '..', '..', 'src', 'features', 'escalations', 'escalation.repository.ts'),
      'utf-8',
    );
    expect(src).toMatch(/BUG-PR-R1-12-FIX-S1-escalations/);
    expect(src).toMatch(/updateWithOptimisticLock/);
    expect(src).toMatch(/expectedLockVersion\?: number/);
  });
});
