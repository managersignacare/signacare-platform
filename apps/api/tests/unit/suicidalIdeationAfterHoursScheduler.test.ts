/**
 * BUG-581 — suicidal-ideation after-hours note scheduler.
 *
 * Pure-function unit tests for time-window matching + processor flow.
 * Live DB query / emit path is covered by integration tests.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  dedupeKeyForAfterHoursSiNote,
  isWithinShiftWindow,
  isWithinTimeWindow,
  matchingBlocksAt,
  processSuicidalIdeationAfterHoursAlerts,
  type AvailabilityBlockRow,
  type SiAfterHoursCandidateRow,
  type SiAfterHoursContext,
  type SiAfterHoursEmitInput,
} from '../../src/jobs/schedulers/suicidalIdeationAfterHoursScheduler';

const NOW = new Date('2026-05-13T04:00:00.000Z'); // 14:00 AEST
const TZ = 'Australia/Melbourne';

function candidate(overrides: Partial<SiAfterHoursCandidateRow> = {}): SiAfterHoursCandidateRow {
  return {
    note_id: '00000000-0000-0000-0000-000000000001',
    clinic_id: '00000000-0000-0000-0000-0000000000c1',
    patient_id: '00000000-0000-0000-0000-0000000000p1',
    author_id: '00000000-0000-0000-0000-0000000000a1',
    note_type: 'progress',
    note_created_at: '2026-05-13T03:55:00.000Z',
    risk_assessment_id: '00000000-0000-0000-0000-0000000000r1',
    overall_risk_level: 'high',
    clinic_timezone: TZ,
    ...overrides,
  };
}

function block(overrides: Partial<AvailabilityBlockRow> = {}): AvailabilityBlockRow {
  return {
    clinician_id: '00000000-0000-0000-0000-0000000000a1',
    colour: 'green',
    recurrence: 'none',
    day_of_week: null,
    specific_date: '2026-05-13',
    start_time: '09:00:00',
    end_time: '17:00:00',
    effective_from: '2026-01-01',
    effective_until: null,
    label: null,
    ...overrides,
  };
}

function buildCtx(
  rows: SiAfterHoursCandidateRow[],
  recipients: { active: string[]; reassignedToAdmin: string | null } = {
    active: ['00000000-0000-0000-0000-0000000000p9'],
    reassignedToAdmin: null,
  },
  withinShift = false,
): SiAfterHoursContext & { emitCalls: SiAfterHoursEmitInput[] } {
  const emitCalls: SiAfterHoursEmitInput[] = [];
  return {
    listCandidateRows: vi.fn(async () => rows),
    isAuthorWithinShift: vi.fn(async () => withinShift),
    resolveOnCallRecipients: vi.fn(async () => recipients),
    emit: vi.fn(async (input) => {
      emitCalls.push(input);
      return { ids: ['nid'], published: true };
    }),
    writeAuditLogRow: vi.fn(async () => undefined),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    emitCalls,
  };
}

describe('BUG-581 — time helpers', () => {
  it('TP-SI-1a: handles normal time windows', () => {
    expect(isWithinTimeWindow('10:00:00', '09:00:00', '17:00:00')).toBe(true);
    expect(isWithinTimeWindow('08:59:59', '09:00:00', '17:00:00')).toBe(false);
  });

  it('TP-SI-1b: handles overnight time windows', () => {
    expect(isWithinTimeWindow('23:30:00', '22:00:00', '06:00:00')).toBe(true);
    expect(isWithinTimeWindow('03:00:00', '22:00:00', '06:00:00')).toBe(true);
    expect(isWithinTimeWindow('12:00:00', '22:00:00', '06:00:00')).toBe(false);
  });

  it('TP-SI-1c: matchingBlocksAt resolves date+time in clinic timezone', () => {
    const matches = matchingBlocksAt(NOW, TZ, [block()]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.specific_date).toBe('2026-05-13');
  });

  it('TP-SI-1d: isWithinShiftWindow requires non-red matching block', () => {
    expect(isWithinShiftWindow(NOW, TZ, [block({ colour: 'red' })])).toBe(false);
    expect(isWithinShiftWindow(NOW, TZ, [block({ colour: 'yellow' })])).toBe(true);
  });

  it('TP-SI-1e: dedupe key is deterministic per note+staff', () => {
    const a = dedupeKeyForAfterHoursSiNote('n1', 'u1');
    const b = dedupeKeyForAfterHoursSiNote('n1', 'u1');
    const c = dedupeKeyForAfterHoursSiNote('n1', 'u2');
    expect(a).toBe('si-after-hours:n1:u1');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('BUG-581 — processor flow', () => {
  it('TP-SI-2a: empty rows emits zero counts + WARN signal', async () => {
    const ctx = buildCtx([]);
    const out = await processSuicidalIdeationAfterHoursAlerts(NOW, ctx);
    expect(out).toEqual({ processed: 0, emitted: 0, errors: 0 });
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'SI_AFTER_HOURS_ZERO_ROWS' }),
      expect.any(String),
    );
  });

  it('TP-SI-2b: author within shift skips notifications', async () => {
    const ctx = buildCtx([candidate()], { active: ['u1'], reassignedToAdmin: null }, true);
    const out = await processSuicidalIdeationAfterHoursAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
    expect(ctx.emitCalls).toHaveLength(0);
  });

  it('TP-SI-2c: after-hours candidate emits critical alert to resolved on-call recipient', async () => {
    const recipient = '00000000-0000-0000-0000-0000000000p9';
    const ctx = buildCtx([candidate()], { active: [recipient], reassignedToAdmin: null }, false);
    const out = await processSuicidalIdeationAfterHoursAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(1);
    expect(out.errors).toBe(0);
    expect(ctx.emitCalls[0]?.userId).toBe(recipient);
    expect(ctx.emitCalls[0]?.severity).toBe('critical');
    expect(ctx.emitCalls[0]?.payload.note_id).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('TP-SI-2d: admin reassignment writes immutable audit row', async () => {
    const admin = '00000000-0000-0000-0000-0000000000ad';
    const ctx = buildCtx([candidate()], { active: [admin], reassignedToAdmin: admin }, false);
    await processSuicidalIdeationAfterHoursAlerts(NOW, ctx);
    expect(ctx.writeAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SI_AFTER_HOURS_RECIPIENT_REASSIGNED',
        noteId: '00000000-0000-0000-0000-000000000001',
      }),
    );
    expect(ctx.emitCalls[0]?.userId).toBe(admin);
  });

  it('TP-SI-2e: no on-call and no admin -> fail-visible + no emit', async () => {
    const ctx = buildCtx([candidate()], { active: [], reassignedToAdmin: null }, false);
    const out = await processSuicidalIdeationAfterHoursAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
    expect(out.errors).toBe(0);
    expect(ctx.writeAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SI_AFTER_HOURS_NO_RECIPIENT_AVAILABLE',
      }),
    );
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'SI_AFTER_HOURS_NO_RECIPIENT_AVAILABLE' }),
      expect.any(String),
    );
  });

  it('TP-SI-2f: row-level exception increments errors and continues', async () => {
    const ctx = buildCtx([
      candidate({ note_id: 'n-fail' }),
      candidate({ note_id: 'n-ok', patient_id: '00000000-0000-0000-0000-0000000000p2' }),
    ]);
    let call = 0;
    ctx.emit = vi.fn(async (input) => {
      call++;
      if (call === 1) throw new Error('emit failed');
      ctx.emitCalls.push(input);
      return { ids: ['ok'], published: true };
    });

    const out = await processSuicidalIdeationAfterHoursAlerts(NOW, ctx);
    expect(out.processed).toBe(2);
    expect(out.errors).toBe(1);
    expect(out.emitted).toBe(1);
  });
});
