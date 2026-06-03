/**
 * BUG-574 — clozapine monitoring-week scheduler.
 *
 * Pure-function unit tests for `processClozapineMonitoringWeekAlerts`
 * and helper logic. Live DB query / emit path is covered by
 * integration tests.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  bucketForNextBloodDueDate,
  dedupeKeyForClozapineMonitoringWeekAlert,
  processClozapineMonitoringWeekAlerts,
  severityForClozapineMonitoringWeekBucket,
  type ClozapineMonitoringWeekContext,
  type ClozapineMonitoringWeekEmitInput,
  type ClozapineMonitoringWeekRow,
} from '../../src/jobs/schedulers/clozapineMonitoringWeekScheduler';

const NOW = new Date('2026-05-13T07:20:00.000Z');

function row(overrides: Partial<ClozapineMonitoringWeekRow> = {}): ClozapineMonitoringWeekRow {
  return {
    registration_id: '00000000-0000-0000-0000-000000000574',
    clinic_id: '00000000-0000-0000-0000-0000000000c1',
    patient_id: '00000000-0000-0000-0000-0000000000p1',
    monitoring_week: 4,
    next_blood_due_date: '2026-05-16', // T-3d vs NOW
    prescriber_staff_id: '00000000-0000-0000-0000-00000000001a',
    primary_clinician_id: '00000000-0000-0000-0000-00000000001b',
    ...overrides,
  };
}

function buildCtx(
  rows: ClozapineMonitoringWeekRow[],
  recipients: { active: string[]; reassignedToAdmin: string | null } = {
    active: ['00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000001b'],
    reassignedToAdmin: null,
  },
): ClozapineMonitoringWeekContext & { emitCalls: ClozapineMonitoringWeekEmitInput[] } {
  const emitCalls: ClozapineMonitoringWeekEmitInput[] = [];
  return {
    listDueWithinWindow: vi.fn(async () => rows),
    emit: vi.fn(async (input) => {
      emitCalls.push(input);
      return { ids: ['nid'], published: true };
    }),
    resolveActiveRecipients: vi.fn(async () => recipients),
    writeAuditLogRow: vi.fn(async () => undefined),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    emitCalls,
  };
}

describe('BUG-574 — bucketForNextBloodDueDate', () => {
  it('TP-CMW-1a: maps canonical buckets', () => {
    expect(bucketForNextBloodDueDate('2026-05-16', NOW)).toBe('T-3d');
    expect(bucketForNextBloodDueDate('2026-05-14', NOW)).toBe('T-1d');
    expect(bucketForNextBloodDueDate('2026-05-13', NOW)).toBe('T-0d');
    expect(bucketForNextBloodDueDate('2026-05-12', NOW)).toBe('T+overdue');
  });

  it('TP-CMW-1b: non-bucket days return null', () => {
    expect(bucketForNextBloodDueDate('2026-05-15', NOW)).toBeNull();
    expect(bucketForNextBloodDueDate('2026-05-17', NOW)).toBeNull();
    expect(bucketForNextBloodDueDate('2026-05-21', NOW)).toBeNull();
  });
});

describe('BUG-574 — helper semantics', () => {
  it('TP-CMW-2a: severity maps warning vs critical', () => {
    expect(severityForClozapineMonitoringWeekBucket('T-3d')).toBe('warning');
    expect(severityForClozapineMonitoringWeekBucket('T-1d')).toBe('critical');
    expect(severityForClozapineMonitoringWeekBucket('T-0d')).toBe('critical');
    expect(severityForClozapineMonitoringWeekBucket('T+overdue')).toBe('critical');
  });

  it('TP-CMW-2b: dedupe key encodes registration + staff + bucket + day', () => {
    const a = dedupeKeyForClozapineMonitoringWeekAlert('r1', 'u1', 'T-3d', new Date('2026-05-13T01:00:00Z'));
    const b = dedupeKeyForClozapineMonitoringWeekAlert('r1', 'u1', 'T-3d', new Date('2026-05-13T23:00:00Z'));
    const c = dedupeKeyForClozapineMonitoringWeekAlert('r1', 'u1', 'T-0d', new Date('2026-05-13T23:00:00Z'));
    const d = dedupeKeyForClozapineMonitoringWeekAlert('r1', 'u1', 'T-3d', new Date('2026-05-14T00:00:00Z'));
    expect(a).toBe('clozapine-monitoring-week:r1:u1:T-3d:fired-day:2026-05-13');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});

describe('BUG-574 — processClozapineMonitoringWeekAlerts', () => {
  it('TP-CMW-3a: empty rows -> zero output + WARN zero-rows signal', async () => {
    const ctx = buildCtx([]);
    const out = await processClozapineMonitoringWeekAlerts(NOW, ctx);
    expect(out).toEqual({ processed: 0, emitted: 0, errors: 0 });
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'CLOZAPINE_MONITORING_WEEK_ZERO_ROWS' }),
      expect.any(String),
    );
  });

  it('TP-CMW-3b: T-3d row emits warning for both recipients', async () => {
    const ctx = buildCtx([row()]);
    const out = await processClozapineMonitoringWeekAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(2);
    expect(out.errors).toBe(0);
    expect(ctx.emitCalls[0]?.severity).toBe('warning');
    expect(ctx.emitCalls[0]?.payload.bucket).toBe('T-3d');
  });

  it('TP-CMW-3c: due-today row emits critical', async () => {
    const ctx = buildCtx([row({ next_blood_due_date: '2026-05-13' })]);
    await processClozapineMonitoringWeekAlerts(NOW, ctx);
    expect(ctx.emitCalls[0]?.severity).toBe('critical');
    expect(ctx.emitCalls[0]?.payload.bucket).toBe('T-0d');
  });

  it('TP-CMW-3d: non-bucket row is skipped', async () => {
    const ctx = buildCtx([row({ next_blood_due_date: '2026-05-15' })]);
    const out = await processClozapineMonitoringWeekAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
    expect(ctx.emitCalls).toHaveLength(0);
  });

  it('TP-CMW-3e: reassignment to admin writes audit trail + emits to admin only', async () => {
    const admin = '00000000-0000-0000-0000-0000000000ad';
    const ctx = buildCtx([row()], { active: [admin], reassignedToAdmin: admin });
    await processClozapineMonitoringWeekAlerts(NOW, ctx);
    expect(ctx.writeAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLOZAPINE_MONITORING_WEEK_RECIPIENT_REASSIGNED',
        registrationId: '00000000-0000-0000-0000-000000000574',
      }),
    );
    expect(ctx.emitCalls).toHaveLength(1);
    expect(ctx.emitCalls[0]?.userId).toBe(admin);
  });

  it('TP-CMW-3f: no active recipients and no admin -> error + no emit + audit row', async () => {
    const ctx = buildCtx([row()], { active: [], reassignedToAdmin: null });
    const out = await processClozapineMonitoringWeekAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
    expect(out.errors).toBe(0);
    expect(ctx.writeAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLOZAPINE_MONITORING_WEEK_NO_RECIPIENT_AVAILABLE',
        registrationId: '00000000-0000-0000-0000-000000000574',
      }),
    );
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'CLOZAPINE_MONITORING_WEEK_NO_RECIPIENT_AVAILABLE' }),
      expect.any(String),
    );
  });

  it('TP-CMW-3g: top-level list throw returns zeroed counts', async () => {
    const ctx: ClozapineMonitoringWeekContext = {
      listDueWithinWindow: vi.fn(async () => {
        throw new Error('DB exploded');
      }),
      emit: vi.fn(),
      resolveActiveRecipients: vi.fn(),
      writeAuditLogRow: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const out = await processClozapineMonitoringWeekAlerts(NOW, ctx);
    expect(out).toEqual({ processed: 0, emitted: 0, errors: 0 });
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('top-level listDueWithinWindow failed'),
    );
  });

  it('TP-CMW-3h: per-row emit throw increments row error and continues', async () => {
    const ctx = buildCtx([
      row({ registration_id: 'r-fail' }),
      row({ registration_id: 'r-ok', patient_id: '00000000-0000-0000-0000-0000000000p2', next_blood_due_date: '2026-05-14' }),
    ]);
    let calls = 0;
    ctx.emit = vi.fn(async (input) => {
      calls++;
      if (input.payload.registration_id === 'r-fail') throw new Error('emit failed');
      ctx.emitCalls.push(input);
      return { ids: ['nid'], published: true };
    });
    const out = await processClozapineMonitoringWeekAlerts(NOW, ctx);
    expect(out.processed).toBe(2);
    expect(out.errors).toBe(1);
    expect(out.emitted).toBe(2);
    expect(calls).toBe(3);
  });
});
