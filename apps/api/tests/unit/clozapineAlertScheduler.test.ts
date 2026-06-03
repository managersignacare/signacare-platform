/**
 * BUG-569 — clozapine FBC overdue alert scheduler.
 *
 * Pure-function unit tests for `processClozapineFbcOverdueAlerts` and its
 * helpers. The scheduler tick itself (`cron.schedule(...)`) and the
 * actual DB query / notification insert live behind an injected
 * context, so these tests need no live DB / no Redis / no time-travel
 * — they exercise the decision logic and fan-out shape directly.
 *
 * Live-DB exercise of the helper SELECT + notifications insert lives
 * in `apps/api/tests/integration/clozapineFbcOverdueAlerts.int.test.ts`
 * (filed as BUG-569-FOLLOWUP-INTEGRATION-TEST when this lands).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isOverdueRegistration,
  dedupeKeyForClozapineFbcOverdue,
  dedupeKeyForClozapineOrphanPrescriber,
  daysOverdue,
  processClozapineFbcOverdueAlerts,
  type ClozapineFbcOverdueEmitInput,
  type ClozapineFbcOverdueContext,
  type ClozapineFbcOverdueRow,
  type ClozapineOrphanPrescriberRow,
} from '../../src/jobs/schedulers/clozapineAlertScheduler';

const NOW = new Date('2026-04-26T15:30:00.000Z');

function row(overrides: Partial<ClozapineFbcOverdueRow> = {}): ClozapineFbcOverdueRow {
  return {
    registration_id: '00000000-0000-0000-0000-000000000001',
    clinic_id: '00000000-0000-0000-0000-0000000000c1',
    patient_id: '00000000-0000-0000-0000-0000000000p1',
    prescriber_staff_id: '00000000-0000-0000-0000-00000000001a',
    primary_clinician_id: '00000000-0000-0000-0000-00000000001b',
    next_blood_due_date: '2026-04-20', // overdue 6 days vs NOW
    last_anc_date: '2026-04-13',
    last_anc_value: '4.5',
    anc_status: 'green',
    monitoring_frequency: 'weekly',
    current_dose_mg: '300',
    ...overrides,
  };
}

function orphanRow(overrides: Partial<ClozapineOrphanPrescriberRow> = {}): ClozapineOrphanPrescriberRow {
  return {
    registration_id: '00000000-0000-0000-0000-000000000099',
    clinic_id: '00000000-0000-0000-0000-0000000000c1',
    patient_id: '00000000-0000-0000-0000-0000000000p1',
    primary_clinician_id: '00000000-0000-0000-0000-00000000001b',
    nominated_admin_staff_id: '00000000-0000-0000-0000-00000000001c',
    delegated_admin_staff_id: null,
    next_blood_due_date: '2026-04-20',
    monitoring_frequency: 'weekly',
    current_dose_mg: '300',
    ...overrides,
  };
}

function buildCtx(
  rows: ClozapineFbcOverdueRow[],
  opts?: {
    orphanRows?: ClozapineOrphanPrescriberRow[];
    activeStaffIds?: string[];
  },
): ClozapineFbcOverdueContext & { emitCalls: ClozapineFbcOverdueEmitInput[] } {
  const emitCalls: ClozapineFbcOverdueEmitInput[] = [];
  const orphanRows = opts?.orphanRows ?? [];
  const activeIds = new Set(opts?.activeStaffIds ?? []);
  return {
    listOverdue: vi.fn(async () => rows),
    listOrphanedPrescriber: vi.fn(async () => orphanRows),
    listActiveStaffIds: vi.fn(async (_clinicId: string, staffIds: string[]) => (
      staffIds.filter((id) => activeIds.has(id))
    )),
    emit: vi.fn(async (input) => {
      emitCalls.push(input);
      return { ids: ['nid'], published: true };
    }),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    emitCalls,
  };
}

describe('BUG-569 — isOverdueRegistration', () => {
  it('TP-CL-1a: next_blood_due_date < today → overdue', () => {
    expect(isOverdueRegistration({ next_blood_due_date: '2026-04-25' }, NOW)).toBe(true);
    expect(isOverdueRegistration({ next_blood_due_date: '2026-04-20' }, NOW)).toBe(true);
    expect(isOverdueRegistration({ next_blood_due_date: '2025-12-01' }, NOW)).toBe(true);
  });

  it('TP-CL-1b: next_blood_due_date >= today → NOT overdue', () => {
    expect(isOverdueRegistration({ next_blood_due_date: '2026-04-26' }, NOW)).toBe(false);
    expect(isOverdueRegistration({ next_blood_due_date: '2026-04-27' }, NOW)).toBe(false);
    expect(isOverdueRegistration({ next_blood_due_date: '2027-01-01' }, NOW)).toBe(false);
  });
});

describe('BUG-569 — dedupeKeyForClozapineFbcOverdue', () => {
  it('TP-CL-2a: dedupe key encodes (registrationId, staffId, fired-day) — bumps daily', () => {
    const k1 = dedupeKeyForClozapineFbcOverdue('r1', 's1', new Date('2026-04-26T01:00:00Z'));
    const k2 = dedupeKeyForClozapineFbcOverdue('r1', 's1', new Date('2026-04-26T23:59:00Z'));
    const k3 = dedupeKeyForClozapineFbcOverdue('r1', 's1', new Date('2026-04-27T00:00:00Z'));
    expect(k1).toBe('clozapine-fbc-overdue:r1:s1:fired-day:2026-04-26');
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it('TP-CL-2b: dedupe key distinguishes registration + staff', () => {
    const a = dedupeKeyForClozapineFbcOverdue('r1', 's1', NOW);
    const b = dedupeKeyForClozapineFbcOverdue('r2', 's1', NOW);
    const c = dedupeKeyForClozapineFbcOverdue('r1', 's2', NOW);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });
});

describe('BUG-569-FOLLOWUP-ORPHAN-PRESCRIBER-FALLBACK — dedupeKey', () => {
  it('TP-CL-2c: orphan-prescriber dedupe key encodes (registrationId, staffId, fired-day)', () => {
    const k = dedupeKeyForClozapineOrphanPrescriber('r1', 's1', new Date('2026-04-26T05:00:00Z'));
    expect(k).toBe('clozapine-orphan-prescriber:r1:s1:fired-day:2026-04-26');
  });
});

describe('BUG-569 — daysOverdue', () => {
  it('TP-CL-3a: returns whole days between next_blood_due_date and today', () => {
    expect(daysOverdue('2026-04-20', NOW)).toBe(6);
    expect(daysOverdue('2026-04-25', NOW)).toBe(1);
  });

  it('TP-CL-3b: returns 0 (clamped) when next-due is today (boundary)', () => {
    expect(daysOverdue('2026-04-26', NOW)).toBe(0);
  });

  it('TP-CL-3c: returns 0 (clamped) when next-due is in the future', () => {
    expect(daysOverdue('2026-04-30', NOW)).toBe(0);
  });
});

describe('BUG-569 — processClozapineFbcOverdueAlerts', () => {
  it('TP-CL-4a: empty rows → emits zero, logs zero-rows WARN', async () => {
    const ctx = buildCtx([]);
    const out = await processClozapineFbcOverdueAlerts(NOW, ctx);
    expect(out).toEqual({ processed: 0, emitted: 0, errors: 0 });
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'CLOZAPINE_FBC_OVERDUE_ZERO_ROWS' }),
      expect.any(String),
    );
  });

  it('TP-CL-4b: overdue row with prescriber + primary clinician → emits TWO notifications', async () => {
    const ctx = buildCtx([row()]);
    const out = await processClozapineFbcOverdueAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(2);
    expect(out.errors).toBe(0);
    expect(ctx.emitCalls).toHaveLength(2);
    const recipients = ctx.emitCalls.map((c) => c.userId).sort();
    expect(recipients).toEqual([
      '00000000-0000-0000-0000-00000000001a',
      '00000000-0000-0000-0000-00000000001b',
    ]);
  });

  it('TP-CL-4c: overdue row with NULL primary_clinician_id → emits ONE notification (prescriber only)', async () => {
    const ctx = buildCtx([row({ primary_clinician_id: null })]);
    const out = await processClozapineFbcOverdueAlerts(NOW, ctx);
    expect(out.emitted).toBe(1);
    expect(ctx.emitCalls[0].userId).toBe('00000000-0000-0000-0000-00000000001a');
  });

  it('TP-CL-4d: prescriber === primary_clinician → de-duplicated to ONE notification', async () => {
    const sameStaff = '00000000-0000-0000-0000-00000000001a';
    const ctx = buildCtx([row({ prescriber_staff_id: sameStaff, primary_clinician_id: sameStaff })]);
    const out = await processClozapineFbcOverdueAlerts(NOW, ctx);
    expect(out.emitted).toBe(1);
    expect(ctx.emitCalls).toHaveLength(1);
  });

  it('TP-CL-4e: NOT-overdue row (next-due >= today) → SKIPPED (no emit)', async () => {
    const ctx = buildCtx([row({ next_blood_due_date: '2026-04-27' })]);
    const out = await processClozapineFbcOverdueAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
  });

  it('TP-CL-4f: emit shape — severity=critical + category=clozapine + dedupeKey + payload', async () => {
    const ctx = buildCtx([row()]);
    await processClozapineFbcOverdueAlerts(NOW, ctx);
    const e = ctx.emitCalls[0];
    expect(e.severity).toBe('critical');
    expect(e.category).toBe('clozapine');
    expect(e.dedupeKey).toMatch(/^clozapine-fbc-overdue:.+:fired-day:2026-04-26$/);
    expect(e.payload).toMatchObject({
      registration_id: '00000000-0000-0000-0000-000000000001',
      patient_id: '00000000-0000-0000-0000-0000000000p1',
      days_overdue: 6,
    });
    expect(e.actionUrl).toBe('/patients/00000000-0000-0000-0000-0000000000p1/clozapine');
    expect(e.body).toContain('FBC monitoring overdue 6 day(s)');
    expect(e.body).toContain('last ANC 4.5 (green) on 2026-04-13');
  });

  it('TP-CL-4g: missing last ANC → body says "no prior ANC on record"', async () => {
    const ctx = buildCtx([row({ last_anc_value: null, last_anc_date: null, anc_status: null })]);
    await processClozapineFbcOverdueAlerts(NOW, ctx);
    expect(ctx.emitCalls[0].body).toContain('no prior ANC on record');
  });

  it('TP-CL-4h: top-level listOverdue throw → returns zeroed counts (cron must not die)', async () => {
    const ctx: ClozapineFbcOverdueContext = {
      listOverdue: vi.fn(async () => { throw new Error('DB exploded'); }),
      listOrphanedPrescriber: vi.fn(async () => []),
      listActiveStaffIds: vi.fn(async () => []),
      emit: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const out = await processClozapineFbcOverdueAlerts(NOW, ctx);
    expect(out).toEqual({ processed: 0, emitted: 0, errors: 0 });
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('top-level listOverdue failed'),
    );
  });

  it('TP-CL-4i: per-row emit throw → counted as error, OTHER rows continue', async () => {
    const ctx = buildCtx([row({ registration_id: 'r-fails' }), row({ registration_id: 'r-ok' })]);
    let calls = 0;
    ctx.emit = vi.fn(async (input) => {
      calls++;
      if (input.payload.registration_id === 'r-fails') throw new Error('emit failed');
      ctx.emitCalls.push(input);
      return { ids: ['nid'], published: true };
    });
    const out = await processClozapineFbcOverdueAlerts(NOW, ctx);
    expect(out.processed).toBe(2);
    // r-fails: 0 emitted, 1 error. r-ok: 2 emitted (prescriber + primary), 0 errors.
    expect(out.errors).toBe(1);
    expect(out.emitted).toBe(2);
    expect(calls).toBe(3); // 1 throw on r-fails + 2 successful on r-ok
  });

  it('TP-CL-4j: orphan-prescriber row emits to active primary + admin recipients', async () => {
    const primary = '00000000-0000-0000-0000-00000000001b';
    const admin = '00000000-0000-0000-0000-00000000001c';
    const ctx = buildCtx([], {
      orphanRows: [orphanRow({ primary_clinician_id: primary, nominated_admin_staff_id: admin })],
      activeStaffIds: [primary, admin],
    });
    const out = await processClozapineFbcOverdueAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(2);
    expect(out.errors).toBe(0);
    const recipients = ctx.emitCalls.map((c) => c.userId);
    expect(recipients).toHaveLength(2);
    expect(recipients).toEqual(expect.arrayContaining([admin, primary]));
    expect(ctx.emitCalls[0]?.payload?.alert_kind).toBe('orphan_prescriber_registration');
  });

  it('TP-CL-4k: orphan-prescriber row with no active recipients logs error and emits none', async () => {
    const ctx = buildCtx([], {
      orphanRows: [orphanRow()],
      activeStaffIds: [],
    });
    const out = await processClozapineFbcOverdueAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
    expect(out.errors).toBe(1);
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'CLOZAPINE_ORPHAN_PRESCRIBER_NO_ACTIVE_RECIPIENT',
      }),
      expect.stringContaining('orphan registration has no active recipient'),
    );
  });
});
