/**
 * BUG-573 — advance-directive review scheduler.
 *
 * Pure-function unit tests for `processAdvanceDirectiveReviewAlerts`
 * and helper logic. Live DB query / emit path is covered by
 * integration tests.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  bucketForValidUntilDate,
  dedupeKeyForAdvanceDirectiveReview,
  processAdvanceDirectiveReviewAlerts,
  severityForAdvanceDirectiveBucket,
  type AdvanceDirectiveReviewContext,
  type AdvanceDirectiveReviewEmitInput,
  type AdvanceDirectiveReviewRow,
} from '../../src/jobs/schedulers/advanceDirectiveReviewScheduler';

const NOW = new Date('2026-05-12T07:10:00.000Z');

function row(overrides: Partial<AdvanceDirectiveReviewRow> = {}): AdvanceDirectiveReviewRow {
  return {
    directive_id: '00000000-0000-0000-0000-000000000571',
    clinic_id: '00000000-0000-0000-0000-0000000000c1',
    patient_id: '00000000-0000-0000-0000-0000000000p1',
    directive_type: 'advance_statement',
    status: 'active',
    valid_until: '2026-06-11', // T-30d vs NOW
    primary_clinician_id: '00000000-0000-0000-0000-00000000001a',
    ...overrides,
  };
}

function buildCtx(
  rows: AdvanceDirectiveReviewRow[],
  recipients: { active: string[]; reassignedToAdmin: string | null } = {
    active: ['00000000-0000-0000-0000-00000000001a'],
    reassignedToAdmin: null,
  },
): AdvanceDirectiveReviewContext & { emitCalls: AdvanceDirectiveReviewEmitInput[] } {
  const emitCalls: AdvanceDirectiveReviewEmitInput[] = [];
  return {
    listReviewDueWithinWindow: vi.fn(async () => rows),
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

describe('BUG-573 — bucketForValidUntilDate', () => {
  it('TP-ADR-1a: maps canonical buckets', () => {
    expect(bucketForValidUntilDate('2026-06-11', NOW)).toBe('T-30d');
    expect(bucketForValidUntilDate('2026-05-26', NOW)).toBe('T-14d');
    expect(bucketForValidUntilDate('2026-05-19', NOW)).toBe('T-7d');
    expect(bucketForValidUntilDate('2026-05-13', NOW)).toBe('T-1d');
    expect(bucketForValidUntilDate('2026-05-11', NOW)).toBe('T+overdue');
  });

  it('TP-ADR-1b: non-bucket days return null', () => {
    expect(bucketForValidUntilDate('2026-05-12', NOW)).toBeNull();
    expect(bucketForValidUntilDate('2026-05-15', NOW)).toBeNull();
    expect(bucketForValidUntilDate('2026-06-05', NOW)).toBeNull();
  });
});

describe('BUG-573 — helper semantics', () => {
  it('TP-ADR-2a: severity maps warning vs critical', () => {
    expect(severityForAdvanceDirectiveBucket('T-30d')).toBe('warning');
    expect(severityForAdvanceDirectiveBucket('T-14d')).toBe('warning');
    expect(severityForAdvanceDirectiveBucket('T-7d')).toBe('warning');
    expect(severityForAdvanceDirectiveBucket('T-1d')).toBe('critical');
    expect(severityForAdvanceDirectiveBucket('T+overdue')).toBe('critical');
  });

  it('TP-ADR-2b: dedupe key encodes directive + staff + bucket + day', () => {
    const a = dedupeKeyForAdvanceDirectiveReview('d1', 'u1', 'T-30d', new Date('2026-05-12T01:00:00Z'));
    const b = dedupeKeyForAdvanceDirectiveReview('d1', 'u1', 'T-30d', new Date('2026-05-12T23:00:00Z'));
    const c = dedupeKeyForAdvanceDirectiveReview('d1', 'u1', 'T-1d', new Date('2026-05-12T23:00:00Z'));
    const d = dedupeKeyForAdvanceDirectiveReview('d1', 'u1', 'T-30d', new Date('2026-05-13T00:00:00Z'));
    expect(a).toBe('advance-directive-review:d1:u1:T-30d:fired-day:2026-05-12');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});

describe('BUG-573 — processAdvanceDirectiveReviewAlerts', () => {
  it('TP-ADR-3a: empty rows -> zero output + WARN zero-rows signal', async () => {
    const ctx = buildCtx([]);
    const out = await processAdvanceDirectiveReviewAlerts(NOW, ctx);
    expect(out).toEqual({ processed: 0, emitted: 0, errors: 0 });
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ADVANCE_DIRECTIVE_REVIEW_ZERO_ROWS' }),
      expect.any(String),
    );
  });

  it('TP-ADR-3b: T-30d row emits warning for active recipient', async () => {
    const ctx = buildCtx([row()]);
    const out = await processAdvanceDirectiveReviewAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(1);
    expect(out.errors).toBe(0);
    expect(ctx.emitCalls[0]?.severity).toBe('warning');
    expect(ctx.emitCalls[0]?.payload.bucket).toBe('T-30d');
  });

  it('TP-ADR-3c: overdue row emits critical', async () => {
    const ctx = buildCtx([row({ valid_until: '2026-05-09' })]);
    await processAdvanceDirectiveReviewAlerts(NOW, ctx);
    expect(ctx.emitCalls[0]?.severity).toBe('critical');
    expect(ctx.emitCalls[0]?.payload.bucket).toBe('T+overdue');
  });

  it('TP-ADR-3d: non-bucket row is skipped', async () => {
    const ctx = buildCtx([row({ valid_until: '2026-05-15' })]);
    const out = await processAdvanceDirectiveReviewAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
    expect(ctx.emitCalls).toHaveLength(0);
  });

  it('TP-ADR-3e: reassignment to admin writes audit trail + emits to admin only', async () => {
    const admin = '00000000-0000-0000-0000-0000000000ad';
    const ctx = buildCtx([row()], { active: [admin], reassignedToAdmin: admin });
    await processAdvanceDirectiveReviewAlerts(NOW, ctx);
    expect(ctx.writeAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADVANCE_DIRECTIVE_REVIEW_RECIPIENT_REASSIGNED',
        directiveId: '00000000-0000-0000-0000-000000000571',
      }),
    );
    expect(ctx.emitCalls).toHaveLength(1);
    expect(ctx.emitCalls[0]?.userId).toBe(admin);
  });

  it('TP-ADR-3f: no active recipients and no admin -> error + no emit + audit row', async () => {
    const ctx = buildCtx([row()], { active: [], reassignedToAdmin: null });
    const out = await processAdvanceDirectiveReviewAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
    expect(out.errors).toBe(0);
    expect(ctx.writeAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADVANCE_DIRECTIVE_REVIEW_NO_RECIPIENT_AVAILABLE',
        directiveId: '00000000-0000-0000-0000-000000000571',
      }),
    );
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ADVANCE_DIRECTIVE_REVIEW_NO_RECIPIENT_AVAILABLE' }),
      expect.any(String),
    );
  });

  it('TP-ADR-3g: top-level list throw returns zeroed counts', async () => {
    const ctx: AdvanceDirectiveReviewContext = {
      listReviewDueWithinWindow: vi.fn(async () => {
        throw new Error('DB exploded');
      }),
      emit: vi.fn(),
      resolveActiveRecipients: vi.fn(),
      writeAuditLogRow: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const out = await processAdvanceDirectiveReviewAlerts(NOW, ctx);
    expect(out).toEqual({ processed: 0, emitted: 0, errors: 0 });
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('top-level listReviewDueWithinWindow failed'),
    );
  });

  it('TP-ADR-3h: per-row emit throw increments row error and continues', async () => {
    const ctx = buildCtx([
      row({ directive_id: 'd-fail', valid_until: '2026-06-11' }),
      row({ directive_id: 'd-ok', patient_id: '00000000-0000-0000-0000-0000000000p2', valid_until: '2026-05-19' }),
    ]);
    let calls = 0;
    ctx.emit = vi.fn(async (input) => {
      calls++;
      if (input.payload.directive_id === 'd-fail') throw new Error('emit failed');
      ctx.emitCalls.push(input);
      return { ids: ['nid'], published: true };
    });
    const out = await processAdvanceDirectiveReviewAlerts(NOW, ctx);
    expect(out.processed).toBe(2);
    expect(out.errors).toBe(1);
    expect(out.emitted).toBe(1);
    expect(calls).toBe(2);
  });
});
