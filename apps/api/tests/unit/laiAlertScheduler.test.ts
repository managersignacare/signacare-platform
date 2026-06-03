/**
 * BUG-570 — LAI due-alert scheduler.
 *
 * Pure-function unit tests for `processLaiDueAlerts` + helper logic.
 * Live DB query / emit path is covered by integration tests.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  bucketForNextDueDate,
  dedupeKeyForLaiAlert,
  processLaiDueAlerts,
  severityForLaiBucket,
  type LaiAlertContext,
  type LaiAlertEmitInput,
  type LaiAlertRow,
} from '../../src/jobs/schedulers/laiAlertScheduler';

const NOW = new Date('2026-05-12T07:00:00.000Z');

function row(overrides: Partial<LaiAlertRow> = {}): LaiAlertRow {
  return {
    schedule_id: '00000000-0000-0000-0000-000000000001',
    clinic_id: '00000000-0000-0000-0000-0000000000c1',
    patient_id: '00000000-0000-0000-0000-0000000000p1',
    drug_name: 'Paliperidone palmitate',
    next_due_date: '2026-05-19', // T-7d vs NOW
    prescriber_staff_id: '00000000-0000-0000-0000-00000000001a',
    primary_clinician_id: '00000000-0000-0000-0000-00000000001b',
    ...overrides,
  };
}

function buildCtx(
  rows: LaiAlertRow[],
  recipients: { active: string[]; reassignedToAdmin: string | null } = {
    active: ['00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000001b'],
    reassignedToAdmin: null,
  },
): LaiAlertContext & { emitCalls: LaiAlertEmitInput[] } {
  const emitCalls: LaiAlertEmitInput[] = [];
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

describe('BUG-570 — bucketForNextDueDate', () => {
  it('TP-LAI-1a: maps canonical buckets', () => {
    expect(bucketForNextDueDate('2026-05-19', NOW)).toBe('T-7d');
    expect(bucketForNextDueDate('2026-05-15', NOW)).toBe('T-3d');
    expect(bucketForNextDueDate('2026-05-13', NOW)).toBe('T-1d');
    expect(bucketForNextDueDate('2026-05-11', NOW)).toBe('T+overdue');
  });

  it('TP-LAI-1b: non-bucket days return null', () => {
    expect(bucketForNextDueDate('2026-05-18', NOW)).toBeNull();
    expect(bucketForNextDueDate('2026-05-16', NOW)).toBeNull();
    expect(bucketForNextDueDate('2026-05-12', NOW)).toBeNull();
    expect(bucketForNextDueDate('2026-05-20', NOW)).toBeNull();
  });
});

describe('BUG-570 — helper semantics', () => {
  it('TP-LAI-2a: severity maps warning vs critical', () => {
    expect(severityForLaiBucket('T-7d')).toBe('warning');
    expect(severityForLaiBucket('T-3d')).toBe('warning');
    expect(severityForLaiBucket('T-1d')).toBe('critical');
    expect(severityForLaiBucket('T+overdue')).toBe('critical');
  });

  it('TP-LAI-2b: dedupe key encodes schedule + staff + bucket + day', () => {
    const a = dedupeKeyForLaiAlert('s1', 'u1', 'T-7d', new Date('2026-05-12T01:00:00Z'));
    const b = dedupeKeyForLaiAlert('s1', 'u1', 'T-7d', new Date('2026-05-12T23:00:00Z'));
    const c = dedupeKeyForLaiAlert('s1', 'u1', 'T-1d', new Date('2026-05-12T23:00:00Z'));
    const d = dedupeKeyForLaiAlert('s1', 'u1', 'T-7d', new Date('2026-05-13T00:00:00Z'));
    expect(a).toBe('lai-dose-due:s1:u1:T-7d:fired-day:2026-05-12');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});

describe('BUG-570 — processLaiDueAlerts', () => {
  it('TP-LAI-3a: empty rows -> zero output + WARN zero-rows signal', async () => {
    const ctx = buildCtx([]);
    const out = await processLaiDueAlerts(NOW, ctx);
    expect(out).toEqual({ processed: 0, emitted: 0, errors: 0 });
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'LAI_ALERT_ZERO_ROWS' }),
      expect.any(String),
    );
  });

  it('TP-LAI-3b: T-7d row emits warning for both recipients', async () => {
    const ctx = buildCtx([row()]);
    const out = await processLaiDueAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(2);
    expect(out.errors).toBe(0);
    expect(ctx.emitCalls[0]?.severity).toBe('warning');
    expect(ctx.emitCalls[0]?.payload.bucket).toBe('T-7d');
  });

  it('TP-LAI-3c: overdue row emits critical', async () => {
    const ctx = buildCtx([row({ next_due_date: '2026-05-10' })]);
    await processLaiDueAlerts(NOW, ctx);
    expect(ctx.emitCalls[0]?.severity).toBe('critical');
    expect(ctx.emitCalls[0]?.payload.bucket).toBe('T+overdue');
  });

  it('TP-LAI-3d: non-bucket row is skipped', async () => {
    const ctx = buildCtx([row({ next_due_date: '2026-05-18' })]);
    const out = await processLaiDueAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
    expect(ctx.emitCalls).toHaveLength(0);
  });

  it('TP-LAI-3e: reassignment to admin writes audit trail + emits to admin only', async () => {
    const admin = '00000000-0000-0000-0000-0000000000ad';
    const ctx = buildCtx([row()], { active: [admin], reassignedToAdmin: admin });
    await processLaiDueAlerts(NOW, ctx);
    expect(ctx.writeAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LAI_DUE_RECIPIENT_REASSIGNED',
        scheduleId: '00000000-0000-0000-0000-000000000001',
      }),
    );
    expect(ctx.emitCalls).toHaveLength(1);
    expect(ctx.emitCalls[0]?.userId).toBe(admin);
  });

  it('TP-LAI-3f: no active recipients and no admin -> error + no emit + audit row', async () => {
    const ctx = buildCtx([row()], { active: [], reassignedToAdmin: null });
    const out = await processLaiDueAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
    expect(out.errors).toBe(0);
    expect(ctx.writeAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LAI_DUE_NO_RECIPIENT_AVAILABLE',
        scheduleId: '00000000-0000-0000-0000-000000000001',
      }),
    );
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'LAI_DUE_NO_RECIPIENT_AVAILABLE' }),
      expect.any(String),
    );
  });

  it('TP-LAI-3g: top-level list throw returns zeroed counts', async () => {
    const ctx: LaiAlertContext = {
      listDueWithinWindow: vi.fn(async () => {
        throw new Error('DB exploded');
      }),
      emit: vi.fn(),
      resolveActiveRecipients: vi.fn(),
      writeAuditLogRow: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const out = await processLaiDueAlerts(NOW, ctx);
    expect(out).toEqual({ processed: 0, emitted: 0, errors: 0 });
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('top-level listDueWithinWindow failed'),
    );
  });

  it('TP-LAI-3h: per-row emit throw increments row error and continues', async () => {
    const ctx = buildCtx([
      row({ schedule_id: 'r-fail' }),
      row({ schedule_id: 'r-ok', patient_id: '00000000-0000-0000-0000-0000000000p2' }),
    ]);
    let calls = 0;
    ctx.emit = vi.fn(async (input) => {
      calls++;
      if (input.payload.schedule_id === 'r-fail') throw new Error('emit failed');
      ctx.emitCalls.push(input);
      return { ids: ['nid'], published: true };
    });
    const out = await processLaiDueAlerts(NOW, ctx);
    expect(out.processed).toBe(2);
    expect(out.errors).toBe(1);
    expect(out.emitted).toBe(2); // second row emits to both recipients
    expect(calls).toBe(3);
  });
});
