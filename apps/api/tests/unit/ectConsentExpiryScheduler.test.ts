/**
 * BUG-572 — ECT consent-expiry scheduler.
 *
 * Pure-function unit tests for `processEctConsentExpiryAlerts` and
 * helper logic. Live DB query / emit path is covered by
 * integration tests.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  bucketForConsentExpiryDate,
  consentExpiryDate,
  dedupeKeyForEctConsentExpiry,
  processEctConsentExpiryAlerts,
  severityForEctConsentBucket,
  type EctConsentEmitInput,
  type EctConsentExpiryContext,
  type EctConsentRow,
} from '../../src/jobs/schedulers/ectConsentExpiryScheduler';

const NOW = new Date('2026-05-13T07:30:00.000Z');

function row(overrides: Partial<EctConsentRow> = {}): EctConsentRow {
  return {
    course_id: '00000000-0000-0000-0000-000000000572',
    clinic_id: '00000000-0000-0000-0000-0000000000c1',
    patient_id: '00000000-0000-0000-0000-0000000000p1',
    status: 'active',
    consent_date: '2026-05-20', // T-7d when validityDays=0
    treating_psychiatrist_id: '00000000-0000-0000-0000-00000000001a',
    primary_clinician_id: '00000000-0000-0000-0000-00000000001b',
    ...overrides,
  };
}

function buildCtx(
  rows: EctConsentRow[],
  recipients: { active: string[]; reassignedToAdmin: string | null } = {
    active: ['00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000001b'],
    reassignedToAdmin: null,
  },
  validityDays = 0,
): EctConsentExpiryContext & { emitCalls: EctConsentEmitInput[] } {
  const emitCalls: EctConsentEmitInput[] = [];
  return {
    listConsentCourses: vi.fn(async () => rows),
    getConsentValidityDays: vi.fn(async () => validityDays),
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

describe('BUG-572 — helper semantics', () => {
  it('TP-ECT-1a: consent expiry date derives from consent_date + validity_days', () => {
    expect(consentExpiryDate('2026-01-01', 30)).toBe('2026-01-31');
    expect(consentExpiryDate('2026-01-01T14:59:00.000Z', 30)).toBe('2026-01-31');
  });

  it('TP-ECT-1b: bucket mapping returns T-7d / overdue / null', () => {
    expect(bucketForConsentExpiryDate('2026-05-20', NOW)).toBe('T-7d');
    expect(bucketForConsentExpiryDate('2026-05-12', NOW)).toBe('T+overdue');
    expect(bucketForConsentExpiryDate('2026-05-25', NOW)).toBeNull();
  });

  it('TP-ECT-1c: severity maps warning vs critical', () => {
    expect(severityForEctConsentBucket('T-7d')).toBe('warning');
    expect(severityForEctConsentBucket('T+overdue')).toBe('critical');
  });

  it('TP-ECT-1d: dedupe key encodes course + staff + bucket + expiry + day', () => {
    const a = dedupeKeyForEctConsentExpiry('c1', 'u1', 'T-7d', '2026-05-20', new Date('2026-05-13T01:00:00Z'));
    const b = dedupeKeyForEctConsentExpiry('c1', 'u1', 'T-7d', '2026-05-20', new Date('2026-05-13T23:00:00Z'));
    const c = dedupeKeyForEctConsentExpiry('c1', 'u1', 'T+overdue', '2026-05-20', new Date('2026-05-13T23:00:00Z'));
    const d = dedupeKeyForEctConsentExpiry('c1', 'u1', 'T-7d', '2026-05-20', new Date('2026-05-14T00:00:00Z'));
    expect(a).toBe('ect-consent-expiry:c1:u1:T-7d:expires:2026-05-20:fired-day:2026-05-13');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});

describe('BUG-572 — processEctConsentExpiryAlerts', () => {
  it('TP-ECT-2a: empty rows -> zero output + WARN zero-rows signal', async () => {
    const ctx = buildCtx([]);
    const out = await processEctConsentExpiryAlerts(NOW, ctx);
    expect(out).toEqual({ processed: 0, emitted: 0, errors: 0 });
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ECT_CONSENT_EXPIRY_ZERO_ROWS' }),
      expect.any(String),
    );
  });

  it('TP-ECT-2b: T-7d row emits warning for both recipients', async () => {
    const ctx = buildCtx([row()]);
    const out = await processEctConsentExpiryAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(2);
    expect(out.errors).toBe(0);
    expect(ctx.emitCalls[0]?.severity).toBe('warning');
    expect(ctx.emitCalls[0]?.payload.bucket).toBe('T-7d');
    expect(ctx.emitCalls[0]?.payload.consent_expires_at).toBe('2026-05-20');
  });

  it('TP-ECT-2c: overdue row emits critical', async () => {
    const ctx = buildCtx([row({ consent_date: '2026-05-12' })]);
    await processEctConsentExpiryAlerts(NOW, ctx);
    expect(ctx.emitCalls[0]?.severity).toBe('critical');
    expect(ctx.emitCalls[0]?.payload.bucket).toBe('T+overdue');
  });

  it('TP-ECT-2d: non-bucket row is skipped', async () => {
    const ctx = buildCtx([row({ consent_date: '2026-05-25' })]);
    const out = await processEctConsentExpiryAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
    expect(ctx.emitCalls).toHaveLength(0);
  });

  it('TP-ECT-2e: reassignment to admin writes audit trail + emits to admin only', async () => {
    const admin = '00000000-0000-0000-0000-0000000000ad';
    const ctx = buildCtx([row()], { active: [admin], reassignedToAdmin: admin });
    await processEctConsentExpiryAlerts(NOW, ctx);
    expect(ctx.writeAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ECT_CONSENT_RECIPIENT_REASSIGNED',
        courseId: '00000000-0000-0000-0000-000000000572',
      }),
    );
    expect(ctx.emitCalls).toHaveLength(1);
    expect(ctx.emitCalls[0]?.userId).toBe(admin);
  });

  it('TP-ECT-2f: no active recipients and no admin -> error + no emit + audit row', async () => {
    const ctx = buildCtx([row()], { active: [], reassignedToAdmin: null });
    const out = await processEctConsentExpiryAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
    expect(out.errors).toBe(0);
    expect(ctx.writeAuditLogRow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ECT_CONSENT_NO_RECIPIENT_AVAILABLE',
        courseId: '00000000-0000-0000-0000-000000000572',
      }),
    );
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ECT_CONSENT_NO_RECIPIENT_AVAILABLE' }),
      expect.any(String),
    );
  });

  it('TP-ECT-2g: top-level list throw returns zeroed counts', async () => {
    const ctx: EctConsentExpiryContext = {
      listConsentCourses: vi.fn(async () => {
        throw new Error('DB exploded');
      }),
      getConsentValidityDays: vi.fn(async () => 0),
      emit: vi.fn(),
      resolveActiveRecipients: vi.fn(),
      writeAuditLogRow: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const out = await processEctConsentExpiryAlerts(NOW, ctx);
    expect(out).toEqual({ processed: 0, emitted: 0, errors: 0 });
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('top-level listConsentCourses failed'),
    );
  });

  it('TP-ECT-2h: per-row emit throw increments row error and continues', async () => {
    const ctx = buildCtx([
      row({ course_id: 'c-fail' }),
      row({ course_id: 'c-ok', patient_id: '00000000-0000-0000-0000-0000000000p2', consent_date: '2026-05-12' }),
    ]);
    let calls = 0;
    ctx.emit = vi.fn(async (input) => {
      calls++;
      if (input.payload.course_id === 'c-fail') throw new Error('emit failed');
      ctx.emitCalls.push(input);
      return { ids: ['nid'], published: true };
    });
    const out = await processEctConsentExpiryAlerts(NOW, ctx);
    expect(out.processed).toBe(2);
    expect(out.errors).toBe(1);
    expect(out.emitted).toBe(2);
    expect(calls).toBe(3);
  });
});
