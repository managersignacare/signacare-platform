/**
 * BUG-372b — MHA review-window alert scheduler.
 *
 * Pure-function unit tests for `processMhaReviewAlerts` and its helpers.
 * Live-DB exercise of the SELECT + emit path lives in
 * `apps/api/tests/integration/mhaReviewAlerts.int.test.ts`.
 *
 * MHA orders (Mental Health Act) carry statutory review windows:
 *   - Assessment orders: 72-hour review
 *   - Treatment / temporary-treatment orders: 28-day review
 *   - Community treatment orders: variable
 *
 * The scheduler emits a tiered notification per order per 24h bucket:
 *   T-7d   — early reminder (severity 'warning')
 *   T-3d   — mid reminder   (severity 'warning')
 *   T-1d   — final reminder (severity 'critical')
 *   T-0d   — review due TODAY (severity 'critical')
 *   T+1d-overdue — order has lapsed (severity 'critical')
 *
 * Both `legal_orders` (canonical) and `patient_legal_orders` (legacy)
 * are unioned in the input — both still in production today.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  bucketForReviewDate,
  dedupeKeyForMhaReview,
  dedupeKeyForMhaMissingReviewDate,
  dedupeKeyForMhaEscalation,
  dedupeKeyForMhaEscalationTier,
  isMhaEscalationDue,
  bucketEligibleForEscalation,
  processMhaReviewAlerts,
  type MhaReviewEmitInput,
  type MhaReviewContext,
  type MhaReviewRow,
  type MhaReviewBucket,
  type MhaMissingReviewDateRow,
} from '../../src/jobs/schedulers/mhaReviewScheduler';

const NOW = new Date('2026-04-26T15:30:00.000Z');
type MhaReviewAuditCall = Parameters<NonNullable<MhaReviewContext['writeAuditLogRow']>>[0];

function row(overrides: Partial<MhaReviewRow> = {}): MhaReviewRow {
  return {
    source_table: 'legal_orders',
    order_id: '00000000-0000-0000-0000-000000000001',
    clinic_id: '00000000-0000-0000-0000-0000000000c1',
    patient_id: '00000000-0000-0000-0000-0000000000p1',
    order_number: 'MHA-001',
    review_date: '2026-04-29', // T-3 days from NOW
    status: 'active',
    order_type_max_duration_days: 28,
    primary_clinician_id: '00000000-0000-0000-0000-0000000000s1',
    creator_staff_id: '00000000-0000-0000-0000-0000000000s2',
    ...overrides,
  };
}

function missingReviewDateRow(
  overrides: Partial<MhaMissingReviewDateRow> = {},
): MhaMissingReviewDateRow {
  return {
    source_table: 'legal_orders',
    order_id: '00000000-0000-0000-0000-000000000101',
    clinic_id: '00000000-0000-0000-0000-0000000000c1',
    patient_id: '00000000-0000-0000-0000-0000000000p1',
    order_number: 'MHA-MISSING-001',
    ...overrides,
  };
}

function buildCtx(rows: MhaReviewRow[]): MhaReviewContext & {
  emitCalls: MhaReviewEmitInput[];
  auditCalls: MhaReviewAuditCall[];
} {
  const emitCalls: MhaReviewEmitInput[] = [];
  const auditCalls: MhaReviewAuditCall[] = [];
  return {
    listOrdersInReviewWindow: vi.fn(async () => rows),
    listActiveOrdersMissingReviewDate: vi.fn(async () => []),
    resolveClinicAdminRecipient: vi.fn(async () => null),
    emit: vi.fn(async (input) => {
      emitCalls.push(input);
      return { ids: ['nid'], published: true };
    }),
    // BUG-584 default — both candidates active, no admin reassignment.
    // Existing TP-MHA-* tests rely on this default to preserve
    // primary+creator fan-out semantics.
    resolveActiveRecipients: vi.fn(async (_clinicId, primary, creator) => {
      const active: string[] = [];
      if (primary) active.push(primary);
      if (creator && creator !== primary) active.push(creator);
      return { active, reassignedToAdmin: null };
    }),
    // BUG-585 default — no escalation tier in default ctx; tests that
    // exercise escalation override this method explicitly.
    listEscalationRecipients: vi.fn(async () => []),
    // BUG-585 default — 60 minutes (matches DEFAULT_THRESHOLDS.
    // mha_review_escalation_minutes). NOW is at 15:30 UTC, so
    // isMhaEscalationDue(NOW, 60) returns true. Tests that need
    // tier-2 NOT to fire override `getEscalationThreshold`.
    getEscalationThreshold: vi.fn(async () => 60),
    // BUG-584 default — capture audit calls.
    writeAuditLogRow: vi.fn(async (input: MhaReviewAuditCall) => {
      auditCalls.push(input);
    }),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    emitCalls,
    auditCalls,
  };
}

function ymdOffset(now: Date, days: number): string {
  const d = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

describe('BUG-372b — bucketForReviewDate', () => {
  it('TP-MHA-1: T-7d bucket when review_date is 7 days away', () => {
    expect(bucketForReviewDate(ymdOffset(NOW, 7), NOW)).toBe('T-7d');
  });

  it('TP-MHA-2: T-3d bucket when review_date is 3 days away', () => {
    expect(bucketForReviewDate(ymdOffset(NOW, 3), NOW)).toBe('T-3d');
  });

  it('TP-MHA-3: T-1d bucket when review_date is 1 day away', () => {
    expect(bucketForReviewDate(ymdOffset(NOW, 1), NOW)).toBe('T-1d');
  });

  it('TP-MHA-4: T-0d bucket when review_date is today', () => {
    expect(bucketForReviewDate(ymdOffset(NOW, 0), NOW)).toBe('T-0d');
  });

  it('TP-MHA-5: T+overdue bucket when review_date is in the past', () => {
    expect(bucketForReviewDate(ymdOffset(NOW, -1), NOW)).toBe('T+overdue');
    expect(bucketForReviewDate(ymdOffset(NOW, -7), NOW)).toBe('T+overdue');
  });

  it('TP-MHA-6: null when outside any tier (e.g. T-14d, T-4d)', () => {
    expect(bucketForReviewDate(ymdOffset(NOW, 14), NOW)).toBeNull();
    expect(bucketForReviewDate(ymdOffset(NOW, 4), NOW)).toBeNull();
    expect(bucketForReviewDate(ymdOffset(NOW, 5), NOW)).toBeNull();
    expect(bucketForReviewDate(ymdOffset(NOW, 2), NOW)).toBeNull();
  });

  it('TP-MHA-6a (BUG-587): narrow-window order uses T-12h within final 12 hours', () => {
    expect(
      bucketForReviewDate(
        ymdOffset(NOW, 0),
        new Date('2026-04-26T15:30:00.000Z'),
        3,
      ),
    ).toBe('T-12h');
  });

  it('TP-MHA-6b (BUG-587): narrow-window order uses T-4h within final 4 hours', () => {
    expect(
      bucketForReviewDate(
        ymdOffset(NOW, 0),
        new Date('2026-04-26T21:30:00.000Z'),
        3,
      ),
    ).toBe('T-4h');
  });

  it('TP-MHA-6c (BUG-587): non-narrow order remains T-0d on due day', () => {
    expect(
      bucketForReviewDate(
        ymdOffset(NOW, 0),
        new Date('2026-04-26T15:30:00.000Z'),
        28,
      ),
    ).toBe('T-0d');
  });
});

describe('BUG-372b — dedupeKeyForMhaReview', () => {
  it('TP-MHA-7: dedupe key encodes (table, orderId, bucket)', () => {
    const k = dedupeKeyForMhaReview('legal_orders', 'order-1', 's1', 'T-3d');
    expect(k).toBe('mha-review:legal_orders:order-1:s1:T-3d');
  });

  it('TP-MHA-8: dedupe key distinguishes the two source tables', () => {
    const a = dedupeKeyForMhaReview('legal_orders', 'order-1', 's1', 'T-3d');
    const b = dedupeKeyForMhaReview('patient_legal_orders', 'order-1', 's1', 'T-3d');
    expect(a).not.toBe(b);
  });

  it('TP-MHA-9: dedupe key distinguishes buckets', () => {
    const buckets: MhaReviewBucket[] = ['T-7d', 'T-3d', 'T-1d', 'T-0d', 'T-12h', 'T-4h', 'T+overdue'];
    const keys = new Set(buckets.map((b) => dedupeKeyForMhaReview('legal_orders', 'order-1', 's1', b)));
    expect(keys.size).toBe(7);
  });
});

describe('BUG-588 — missing review_date data-quality alerts', () => {
  it('TP-MHA-9a: dedupe key includes source/order/admin/day axes', () => {
    const key = dedupeKeyForMhaMissingReviewDate(
      'legal_orders',
      'order-1',
      'admin-1',
      NOW,
    );
    expect(key).toBe(
      'mha-review-missing-review-date:legal_orders:order-1:admin-1:fired-day:2026-04-26',
    );
  });

  it('TP-MHA-9b: emits bell-only data-quality notification to clinic admin for active order missing review_date', async () => {
    const ctx = buildCtx([]);
    const missing = missingReviewDateRow({
      source_table: 'patient_legal_orders',
      order_id: 'missing-1',
      patient_id: 'p-missing-1',
      order_number: 'MHA-MISSING-1',
    });
    ctx.listActiveOrdersMissingReviewDate = vi.fn(async () => [missing]);
    ctx.resolveClinicAdminRecipient = vi.fn(async () => 'admin-1');

    const out = await processMhaReviewAlerts(NOW, ctx);

    expect(out.emitted).toBe(1);
    expect(ctx.emitCalls).toHaveLength(1);
    expect(ctx.emitCalls[0]).toMatchObject({
      clinicId: missing.clinic_id,
      userId: 'admin-1',
      severity: 'warning',
      category: 'mha-review',
      channels: ['bell'],
      payload: expect.objectContaining({
        issue_kind: 'missing_review_date',
        source_table: 'patient_legal_orders',
        order_id: 'missing-1',
      }),
    });
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'MHA_REVIEW_MISSING_REVIEW_DATE',
        orderId: 'missing-1',
        adminStaffId: 'admin-1',
      }),
      expect.any(String),
    );
  });

  it('TP-MHA-9c: when bell insert dedupes (ids=[]) no duplicate WARN is logged', async () => {
    const ctx = buildCtx([]);
    const missing = missingReviewDateRow({ order_id: 'missing-2' });
    ctx.listActiveOrdersMissingReviewDate = vi.fn(async () => [missing]);
    ctx.resolveClinicAdminRecipient = vi.fn(async () => 'admin-1');
    ctx.emit = vi.fn(async (input) => {
      ctx.emitCalls.push(input);
      return { ids: [], published: false };
    });

    const out = await processMhaReviewAlerts(NOW, ctx);

    expect(out.emitted).toBe(0);
    expect(ctx.emitCalls).toHaveLength(1);
    expect(ctx.logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'MHA_REVIEW_MISSING_REVIEW_DATE' }),
      expect.any(String),
    );
  });

  it('TP-MHA-9d: no active clinic admin -> logs structured WARN and skips emit', async () => {
    const ctx = buildCtx([]);
    const missing = missingReviewDateRow({ order_id: 'missing-3' });
    ctx.listActiveOrdersMissingReviewDate = vi.fn(async () => [missing]);
    ctx.resolveClinicAdminRecipient = vi.fn(async () => null);

    const out = await processMhaReviewAlerts(NOW, ctx);

    expect(out.emitted).toBe(0);
    expect(ctx.emitCalls).toHaveLength(0);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'MHA_REVIEW_MISSING_REVIEW_DATE_NO_ADMIN',
        orderId: 'missing-3',
      }),
      expect.any(String),
    );
  });
});

describe('BUG-372b — processMhaReviewAlerts', () => {
  it('TP-MHA-10: emits to BOTH primary_clinician_id AND creator_staff_id when distinct', async () => {
    const r = row({
      review_date: ymdOffset(NOW, 3),
      primary_clinician_id: 'sA',
      creator_staff_id: 'sB',
    });
    const ctx = buildCtx([r]);
    const out = await processMhaReviewAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(2);
    const userIds = ctx.emitCalls.map((c) => c.userId).sort();
    expect(userIds).toEqual(['sA', 'sB']);
  });

  it('TP-MHA-11: emits ONCE when primary_clinician === creator', async () => {
    const r = row({
      review_date: ymdOffset(NOW, 3),
      primary_clinician_id: 'sX',
      creator_staff_id: 'sX',
    });
    const ctx = buildCtx([r]);
    const out = await processMhaReviewAlerts(NOW, ctx);
    expect(out.emitted).toBe(1);
  });

  it('TP-MHA-12: severity warning at T-7d / T-3d; critical at T-1d / T-0d / T+overdue', async () => {
    const rows = [
      row({ order_id: 'o7', review_date: ymdOffset(NOW, 7) }),
      row({ order_id: 'o3', review_date: ymdOffset(NOW, 3) }),
      row({ order_id: 'o1', review_date: ymdOffset(NOW, 1) }),
      row({ order_id: 'o0', review_date: ymdOffset(NOW, 0) }),
      row({ order_id: 'oOver', review_date: ymdOffset(NOW, -2) }),
    ];
    const ctx = buildCtx(rows);
    await processMhaReviewAlerts(NOW, ctx);
    const sevByOrder: Record<string, string> = {};
    for (const c of ctx.emitCalls) sevByOrder[c.payload.order_id] = c.severity;
    expect(sevByOrder['o7']).toBe('warning');
    expect(sevByOrder['o3']).toBe('warning');
    expect(sevByOrder['o1']).toBe('critical');
    expect(sevByOrder['o0']).toBe('critical');
    expect(sevByOrder['oOver']).toBe('critical');
  });

  it('TP-MHA-12a (BUG-587): narrow-window due-today row emits T-12h bucket', async () => {
    const r = row({
      order_id: 'n12h',
      review_date: ymdOffset(NOW, 0),
      order_type_max_duration_days: 3,
    });
    const ctx = buildCtx([r]);
    await processMhaReviewAlerts(new Date('2026-04-26T15:30:00.000Z'), ctx);
    expect(ctx.emitCalls).toHaveLength(2);
    expect(ctx.emitCalls[0].payload.bucket).toBe('T-12h');
    expect(ctx.emitCalls[1].payload.bucket).toBe('T-12h');
    expect(ctx.emitCalls[0].severity).toBe('critical');
  });

  it('TP-MHA-13: skips rows whose review_date is outside any bucket window', async () => {
    const r = row({ review_date: ymdOffset(NOW, 4) }); // not in {7,3,1,0,past}
    const ctx = buildCtx([r]);
    const out = await processMhaReviewAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
  });

  it('TP-MHA-14: dedupe key includes both source_table options', async () => {
    const r1 = row({ source_table: 'legal_orders', order_id: 'o1', review_date: ymdOffset(NOW, 3) });
    const r2 = row({ source_table: 'patient_legal_orders', order_id: 'o1', review_date: ymdOffset(NOW, 3) });
    const ctx = buildCtx([r1, r2]);
    await processMhaReviewAlerts(NOW, ctx);
    const keys = ctx.emitCalls.map((c) => c.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('TP-MHA-15: per-row failure does not stop subsequent rows', async () => {
    const rows = [row({ order_id: 'r1', review_date: ymdOffset(NOW, 3) }), row({ order_id: 'r2', review_date: ymdOffset(NOW, 3) })];
    const ctx = buildCtx(rows);
    let nth = 0;
    ctx.emit = vi.fn(async (input) => {
      nth++;
      if (nth === 1) throw new Error('boom');
      ctx.emitCalls.push(input);
      return { ids: ['nid'], published: true };
    });
    const out = await processMhaReviewAlerts(NOW, ctx);
    expect(out.processed).toBe(2);
    expect(out.errors).toBeGreaterThanOrEqual(1);
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('TP-MHA-16: top-level listOrdersInReviewWindow failure → zeroed counts + error log', async () => {
    const ctx = buildCtx([]);
    ctx.listOrdersInReviewWindow = vi.fn(async () => { throw new Error('db down'); });
    const out = await processMhaReviewAlerts(NOW, ctx);
    expect(out.processed).toBe(0);
    expect(out.emitted).toBe(0);
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('TP-MHA-17: zero-row tick emits structured WARN log for observability', async () => {
    const ctx = buildCtx([]);
    await processMhaReviewAlerts(NOW, ctx);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });
});

describe('BUG-585 — dedupeKeyForMhaEscalation', () => {
  it('TP-MHA-18: escalation key has distinct prefix from tier-1 + includes fired-day', () => {
    const e = dedupeKeyForMhaEscalation('legal_orders', 'o1', 's1', 'T-0d', NOW);
    const t = dedupeKeyForMhaReview('legal_orders', 'o1', 's1', 'T-0d');
    expect(e).toBe('mha-review-escalation:legal_orders:o1:s1:T-0d:fired-day:2026-04-26');
    expect(t).toBe('mha-review:legal_orders:o1:s1:T-0d');
    expect(e).not.toBe(t);
  });

  it('TP-MHA-19: escalation key encodes (sourceTable, orderId, staffId, bucket)', () => {
    const a = dedupeKeyForMhaEscalation('legal_orders', 'o1', 's1', 'T-0d', NOW);
    const b = dedupeKeyForMhaEscalation('patient_legal_orders', 'o1', 's1', 'T-0d', NOW);
    const c = dedupeKeyForMhaEscalation('legal_orders', 'o2', 's1', 'T-0d', NOW);
    const d = dedupeKeyForMhaEscalation('legal_orders', 'o1', 's2', 'T-0d', NOW);
    const e = dedupeKeyForMhaEscalation('legal_orders', 'o1', 's1', 'T-1d', NOW);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).not.toBe(e);
  });

  it('TP-MHA-19b: escalation key bumps DAILY for perpetually-overdue orders', () => {
    // BUG-585 cycle-2 absorb-2 — pre-fix the dedupe key omitted the
    // day component, so tier-2 fired ONCE per (order, staff, bucket)
    // and was permanently silent. Sibling pathology scheduler re-fires
    // daily. This test pins the daily-bump behaviour for MHA tier-2.
    const day1 = new Date('2026-04-26T15:30:00.000Z');
    const day2 = new Date('2026-04-27T15:30:00.000Z');
    const day3 = new Date('2026-04-28T15:30:00.000Z');
    const k1 = dedupeKeyForMhaEscalation('legal_orders', 'o1', 's1', 'T+overdue', day1);
    const k2 = dedupeKeyForMhaEscalation('legal_orders', 'o1', 's1', 'T+overdue', day2);
    const k3 = dedupeKeyForMhaEscalation('legal_orders', 'o1', 's1', 'T+overdue', day3);
    expect(k1).not.toBe(k2);
    expect(k2).not.toBe(k3);
    expect(k1).toBe('mha-review-escalation:legal_orders:o1:s1:T+overdue:fired-day:2026-04-26');
    expect(k3).toBe('mha-review-escalation:legal_orders:o1:s1:T+overdue:fired-day:2026-04-28');
  });

  it('TP-MHA-19c (BUG-585-FOLLOWUP): tier-specific escalation namespaces are distinct', () => {
    const k2 = dedupeKeyForMhaEscalationTier('legal_orders', 'o1', 's1', 'T-0d', 2, NOW);
    const k3 = dedupeKeyForMhaEscalationTier('legal_orders', 'o1', 's1', 'T-0d', 3, NOW);
    const k4 = dedupeKeyForMhaEscalationTier('legal_orders', 'o1', 's1', 'T-0d', 4, NOW);
    expect(k2).toBe('mha-review-escalation:legal_orders:o1:s1:T-0d:fired-day:2026-04-26');
    expect(k3).toBe('mha-review-governance-escalation:legal_orders:o1:s1:T-0d:fired-day:2026-04-26');
    expect(k4).toBe('mha-review-regulatory-escalation:legal_orders:o1:s1:T-0d:fired-day:2026-04-26');
  });
});

describe('BUG-585 — isMhaEscalationDue (per-clinic threshold, AEST-anchored)', () => {
  // BUG-585 cycle-2 absorb (L3 #2) — predicate is anchored to AEST
  // midnight (the cron's own timezone Australia/Melbourne), NOT UTC
  // midnight. Pre-cycle-2 used UTC midnight which produced a 14-hour
  // skew under AEST (cron tick at 00:00 AEST = 14:00 UTC the prior
  // day). Test inputs use UTC times that correspond to specific AEST
  // wall-clock times — AEST midnight on 2026-04-26 = 2026-04-25T14:00Z
  // (AEST=UTC+10 since DST ended on first Sunday of April).
  // NOW = 2026-04-26T15:30:00Z = 2026-04-27T01:30 AEST → 90 min into AEST day.
  it('TP-MHA-20: T+90min into AEST day vs threshold 60 → DUE', () => {
    expect(isMhaEscalationDue(NOW, 60)).toBe(true);
  });
  it('TP-MHA-21: AEST midnight tick + threshold 60 → NOT due', () => {
    const aestMidnight = new Date('2026-04-25T14:00:00.000Z'); // = 2026-04-26 00:00 AEST
    expect(isMhaEscalationDue(aestMidnight, 60)).toBe(false);
  });
  it('TP-MHA-22: 30 min after AEST midnight + threshold 60 → NOT due', () => {
    const t = new Date('2026-04-25T14:30:00.000Z'); // = 2026-04-26 00:30 AEST
    expect(isMhaEscalationDue(t, 60)).toBe(false);
  });
  it('TP-MHA-23: 60 min past AEST midnight + threshold 60 → DUE (boundary inclusive)', () => {
    const t = new Date('2026-04-25T15:00:00.000Z'); // = 2026-04-26 01:00 AEST
    expect(isMhaEscalationDue(t, 60)).toBe(true);
  });
  it('TP-MHA-24: tighter per-clinic 30-min threshold — fires earlier', () => {
    const t = new Date('2026-04-25T14:30:00.000Z'); // = 2026-04-26 00:30 AEST
    expect(isMhaEscalationDue(t, 30)).toBe(true);
  });
  it('TP-MHA-24b: tier-1 + tier-2 do NOT collapse onto the same cron tick (cycle-2 absorb)', () => {
    // BUG-585 cycle-2 absorb (L3 #2) regression test — at AEST 00:00
    // (the FIRST cron tick of the bucket day), default 60-min
    // threshold MUST NOT be due. Pre-cycle-2 the UTC-midnight anchor
    // returned true here because age-since-UTC-midnight was 14 hours.
    const aestMidnightCronTick = new Date('2026-04-25T14:00:00.000Z');
    expect(isMhaEscalationDue(aestMidnightCronTick, 60)).toBe(false);
    // 1 hour later (the next hourly cron tick) it IS due.
    const oneHourLater = new Date('2026-04-25T15:00:00.000Z');
    expect(isMhaEscalationDue(oneHourLater, 60)).toBe(true);
  });
});

describe('BUG-585 — bucketEligibleForEscalation', () => {
  it('TP-MHA-25: critical buckets (T-1d/T-0d/T+overdue) ARE eligible', () => {
    expect(bucketEligibleForEscalation('T-1d')).toBe(true);
    expect(bucketEligibleForEscalation('T-0d')).toBe(true);
    expect(bucketEligibleForEscalation('T+overdue')).toBe(true);
  });
  it('TP-MHA-26: warning buckets (T-7d/T-3d) are NOT eligible', () => {
    expect(bucketEligibleForEscalation('T-7d')).toBe(false);
    expect(bucketEligibleForEscalation('T-3d')).toBe(false);
  });
});

describe('BUG-584 — resolveActiveRecipients integration + AHPRA audit_log', () => {
  it('TP-MHA-27: BOTH inactive → admin fallback emits + WARN log + audit_log row', async () => {
    const r = row({
      review_date: ymdOffset(NOW, 0), // T-0d critical
      primary_clinician_id: 'inactive-A',
      creator_staff_id: 'inactive-B',
    });
    const ctx = buildCtx([r]);
    ctx.resolveActiveRecipients = vi.fn(async () => ({
      active: ['admin-X'],
      reassignedToAdmin: 'admin-X',
    }));
    const out = await processMhaReviewAlerts(NOW, ctx);
    expect(out.emitted).toBe(1); // tier-1 to admin (no tier-2 because empty escalation list default)
    expect(ctx.emitCalls[0]?.userId).toBe('admin-X');
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'MHA_REVIEW_RECIPIENT_REASSIGNED_TO_ADMIN',
        adminStaffId: 'admin-X',
      }),
      expect.any(String),
    );
    // BUG-584 — audit_log row paired with WARN for AHPRA Standard 1.
    expect(ctx.auditCalls).toHaveLength(1);
    expect(ctx.auditCalls[0]).toMatchObject({
      action: 'MHA_REVIEW_RECIPIENT_REASSIGNED',
      sourceTable: r.source_table,
      orderId: r.order_id,
      clinicId: r.clinic_id,
      metadata: expect.objectContaining({
        primary_clinician_id: 'inactive-A',
        creator_staff_id: 'inactive-B',
        admin_staff_id: 'admin-X',
        reason: 'both_originals_inactive',
        system_actor: 'mha-review-scheduler',
      }),
    });
  });

  it('TP-MHA-28: BOTH inactive AND no admin configured → ERROR log + audit_log row (silent-drop closure)', async () => {
    // BUG-584 silent-drop closure: worst-case scenario (statutory-
    // review-deadline alert with NO recipient) emits ERROR + audit_log.
    const r = row({
      review_date: ymdOffset(NOW, 0),
      primary_clinician_id: 'inactive-A',
      creator_staff_id: 'inactive-B',
    });
    const ctx = buildCtx([r]);
    ctx.resolveActiveRecipients = vi.fn(async () => ({
      active: [],
      reassignedToAdmin: null,
    }));
    const out = await processMhaReviewAlerts(NOW, ctx);
    expect(out.emitted).toBe(0);
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'MHA_REVIEW_NO_RECIPIENT_AVAILABLE',
        sourceTable: r.source_table,
        orderId: r.order_id,
        bucket: 'T-0d',
      }),
      expect.stringContaining('dropped alert'),
    );
    expect(ctx.auditCalls).toHaveLength(1);
    expect(ctx.auditCalls[0]).toMatchObject({
      action: 'MHA_REVIEW_NO_RECIPIENT_AVAILABLE',
      sourceTable: r.source_table,
      orderId: r.order_id,
      metadata: expect.objectContaining({
        reason: 'no_admin_configured',
        system_actor: 'mha-review-scheduler',
      }),
    });
  });

  it('TP-MHA-29: ONE inactive (creator) → emits to active primary only, no WARN, no audit', async () => {
    const r = row({
      review_date: ymdOffset(NOW, 0),
      primary_clinician_id: 'sA',
      creator_staff_id: 'inactive-B',
    });
    const ctx = buildCtx([r]);
    ctx.resolveActiveRecipients = vi.fn(async () => ({
      active: ['sA'],
      reassignedToAdmin: null,
    }));
    const out = await processMhaReviewAlerts(NOW, ctx);
    expect(out.emitted).toBe(1);
    expect(ctx.emitCalls[0]?.userId).toBe('sA');
    expect(ctx.auditCalls).toHaveLength(0);
  });
});

describe('BUG-585 — tier-2 escalation integration', () => {
  it('TP-MHA-30: warning bucket (T-7d) → tier-2 NOT fired (only critical buckets)', async () => {
    const r = row({ review_date: ymdOffset(NOW, 7) }); // T-7d warning
    const ctx = buildCtx([r]);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1']);
    const out = await processMhaReviewAlerts(NOW, ctx);
    expect(out.emitted).toBe(2); // tier-1 only (primary + creator)
    expect(ctx.listEscalationRecipients).not.toHaveBeenCalled();
    const tiers = ctx.emitCalls.map((c) => c.payload.tier).sort();
    expect(tiers).toEqual([1, 1]);
  });

  it('TP-MHA-31: critical bucket (T-0d) + threshold elapsed → tier-2 fires to team-leads', async () => {
    const r = row({ review_date: ymdOffset(NOW, 0) }); // T-0d critical
    const ctx = buildCtx([r]);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1', 'admin-X']);
    const out = await processMhaReviewAlerts(NOW, ctx);
    // Tier-1: 2 (primary + creator); Tier-2: 2 (team-lead-1 + admin-X).
    expect(out.emitted).toBe(4);
    const tier2 = ctx.emitCalls.filter((c) => c.payload.tier === 2);
    expect(tier2).toHaveLength(2);
    expect(tier2[0].dedupeKey).toMatch(/^mha-review-escalation:/);
    expect(tier2[0].title).toContain('[ESCALATION]');
  });

  it('TP-MHA-32: tier-2 dedupes against tier-1 — staff already on tier-1 not re-notified', async () => {
    const r = row({
      review_date: ymdOffset(NOW, 0),
      primary_clinician_id: 'sA',
      creator_staff_id: 'sB',
    });
    const ctx = buildCtx([r]);
    ctx.listEscalationRecipients = vi.fn(async () => ['sA', 'team-lead-1', 'admin-X']);
    const out = await processMhaReviewAlerts(NOW, ctx);
    expect(out.emitted).toBe(4); // tier-1: sA+sB; tier-2: team-lead-1+admin-X (sA filtered)
    const tier2UserIds = ctx.emitCalls
      .filter((c) => c.payload.tier === 2)
      .map((c) => c.userId)
      .sort();
    expect(tier2UserIds).toEqual(['admin-X', 'team-lead-1']);
  });

  it('TP-MHA-33: per-clinic 30-min threshold — fires at AEST T+45min after midnight', async () => {
    // AEST 2026-04-26 00:45 = 2026-04-25T14:45:00Z (AEST = UTC+10).
    const t = new Date('2026-04-25T14:45:00.000Z');
    const r = row({ review_date: ymdOffset(t, 0) }); // T-0d (UTC-day match)
    const ctx = buildCtx([r]);
    ctx.getEscalationThreshold = vi.fn(async () => 30);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1']);
    const out = await processMhaReviewAlerts(t, ctx);
    expect(out.emitted).toBe(3); // tier-1: 2; tier-2: 1
    const tier2 = ctx.emitCalls.filter((c) => c.payload.tier === 2);
    expect(tier2).toHaveLength(1);
  });

  it('TP-MHA-34: per-clinic 240-min threshold — at AEST T+30min does NOT fire tier-2', async () => {
    // AEST 2026-04-26 00:30 = 2026-04-25T14:30:00Z. 30 min into AEST
    // day, threshold 240 → not due.
    const t = new Date('2026-04-25T14:30:00.000Z');
    const r = row({ review_date: ymdOffset(t, 0) });
    const ctx = buildCtx([r]);
    ctx.getEscalationThreshold = vi.fn(async () => 240);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1']);
    const out = await processMhaReviewAlerts(t, ctx);
    expect(out.emitted).toBe(2); // tier-1 only
    expect(ctx.listEscalationRecipients).not.toHaveBeenCalled();
  });

  it('TP-MHA-35: escalation-threshold cache — same clinic resolved once per tick', async () => {
    const r1 = row({ order_id: 'oA', review_date: ymdOffset(NOW, 0) });
    const r2 = row({ order_id: 'oB', review_date: ymdOffset(NOW, 0) });
    const ctx = buildCtx([r1, r2]);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1']);
    await processMhaReviewAlerts(NOW, ctx);
    // Both rows share clinic_id; getEscalationThreshold should be invoked once.
    expect(ctx.getEscalationThreshold).toHaveBeenCalledTimes(1);
  });

  it('TP-MHA-36: tier-2 title + body use ACTUAL threshold label (60min+, 1h+, etc.)', async () => {
    // Default threshold is 60 → "1h+" formatted (divisible by 60).
    const r = row({ review_date: ymdOffset(NOW, 0), order_number: 'MHA-X1' });
    const ctx = buildCtx([r]);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1']);
    await processMhaReviewAlerts(NOW, ctx);
    const tier2 = ctx.emitCalls.find((c) => c.payload.tier === 2);
    expect(tier2).toBeDefined();
    if (!tier2) throw new Error('expected tier-2 emit');
    expect(tier2.title).toContain('1h+');
    expect(tier2.body).toContain('unacknowledged for 1h+');
    expect(tier2.body).toContain('verify the primary clinician was reached');
  });

  it('TP-MHA-37: per-clinic 30-min threshold renders "30min+" (NOT "1h+")', async () => {
    const t = new Date('2026-04-25T14:45:00.000Z'); // AEST 2026-04-26 00:45
    const r = row({ review_date: ymdOffset(t, 0), order_number: 'MHA-X2' });
    const ctx = buildCtx([r]);
    ctx.getEscalationThreshold = vi.fn(async () => 30);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1']);
    await processMhaReviewAlerts(t, ctx);
    const tier2 = ctx.emitCalls.find((c) => c.payload.tier === 2);
    expect(tier2).toBeDefined();
    if (!tier2) throw new Error('expected tier-2 emit');
    expect(tier2.title).toContain('30min+');
    expect(tier2.title).not.toContain('1h+');
  });
});

describe('BUG-584 cycle-2 absorb (L3 #1) — silent-drop tier-2 safety net', () => {
  it('TP-MHA-38: tier-1 silent-dropped (no recipient) BUT tier-2 STILL fires to team-leads', async () => {
    // BUG-584 cycle-2 absorb (L3 #1) — when both originals inactive
    // AND no admin configured, tier-1 emits zero; the prior cycle-1
    // implementation `continue;`d here, defeating tier-2 escalation.
    // Cycle-2 falls through so tier-2 to team-leads still has a
    // chance to fire. This is the WORST-CASE clinical-safety scenario
    // BUG-585 was filed to cover (sibling-perfect with pathology).
    const r = row({
      review_date: ymdOffset(NOW, 0), // T-0d critical
      primary_clinician_id: 'inactive-A',
      creator_staff_id: 'inactive-B',
    });
    const ctx = buildCtx([r]);
    ctx.resolveActiveRecipients = vi.fn(async () => ({
      active: [],
      reassignedToAdmin: null, // no clinic admin configured
    }));
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1', 'team-lead-2']);
    const out = await processMhaReviewAlerts(NOW, ctx);
    // Tier-1: 0 (silent drop, ERROR + audit_log fired). Tier-2: 2.
    expect(out.emitted).toBe(2);
    const tier2 = ctx.emitCalls.filter((c) => c.payload.tier === 2);
    expect(tier2).toHaveLength(2);
    const tier2UserIds = tier2.map((c) => c.userId).sort();
    expect(tier2UserIds).toEqual(['team-lead-1', 'team-lead-2']);
    // Silent-drop ERROR + audit_log row fired (BUG-584 cycle-1).
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'MHA_REVIEW_NO_RECIPIENT_AVAILABLE' }),
      expect.anything(),
    );
    expect(ctx.auditCalls).toHaveLength(1);
    expect(ctx.auditCalls[0].action).toBe('MHA_REVIEW_NO_RECIPIENT_AVAILABLE');
  });

  it('TP-MHA-39: silent-drop on warning bucket (T-7d) does NOT attempt tier-2 escalation', async () => {
    // Warning buckets don't escalate per bucketEligibleForEscalation.
    // Silent-drop still writes ERROR + audit_log but no tier-2 fires.
    const r = row({
      review_date: ymdOffset(NOW, 7), // T-7d warning
      primary_clinician_id: 'inactive-A',
      creator_staff_id: 'inactive-B',
    });
    const ctx = buildCtx([r]);
    ctx.resolveActiveRecipients = vi.fn(async () => ({
      active: [],
      reassignedToAdmin: null,
    }));
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1']);
    const out = await processMhaReviewAlerts(NOW, ctx);
    expect(out.emitted).toBe(0); // tier-1: 0; tier-2: 0 (warning bucket).
    expect(ctx.listEscalationRecipients).not.toHaveBeenCalled();
    expect(ctx.logger.error).toHaveBeenCalled(); // silent-drop floor still fires
    expect(ctx.auditCalls).toHaveLength(1);
  });
});

describe('BUG-585-FOLLOWUP-MULTI-TIER-CASCADE', () => {
  it('TP-MHA-40: tier-3/tier-4 chain emits with distinct payload tiers and lower-tier dedupe', async () => {
    const t = new Date('2026-04-25T23:00:00.000Z'); // 2026-04-26 09:00 AEST
    const r = row({
      review_date: ymdOffset(t, 0), // T-0d
      primary_clinician_id: 'sA',
      creator_staff_id: 'sB',
    });
    const ctx = buildCtx([r]);
    ctx.getEscalationThreshold = vi.fn(async () => 60);
    ctx.getEscalationThresholdByTier = vi.fn(async (_clinicId, tier) => {
      if (tier === 2) return 60;
      if (tier === 3) return 120;
      return 240;
    });
    ctx.listEscalationRecipientsByTier = vi.fn(async (_clinicId, _patientId, tier) => {
      if (tier === 2) return ['sA', 'team-lead-1'];
      if (tier === 3) return ['team-lead-1', 'governance-1'];
      return ['governance-1', 'regulatory-1'];
    });

    const out = await processMhaReviewAlerts(t, ctx);
    expect(out.emitted).toBe(5); // tier-1(2) + tier-2(1) + tier-3(1) + tier-4(1)
    const tier2 = ctx.emitCalls.filter((c) => c.payload.tier === 2).map((c) => c.userId);
    const tier3 = ctx.emitCalls.filter((c) => c.payload.tier === 3).map((c) => c.userId);
    const tier4 = ctx.emitCalls.filter((c) => c.payload.tier === 4).map((c) => c.userId);
    expect(tier2).toEqual(['team-lead-1']);
    expect(tier3).toEqual(['governance-1']);
    expect(tier4).toEqual(['regulatory-1']);
  });

  it('TP-MHA-41: at AEST T+90min only tier-2 is due (tier-3/4 remain gated)', async () => {
    const t = new Date('2026-04-25T15:30:00.000Z'); // 2026-04-26 01:30 AEST
    const r = row({ review_date: ymdOffset(t, 0) });
    const ctx = buildCtx([r]);
    ctx.getEscalationThreshold = vi.fn(async () => 60);
    ctx.getEscalationThresholdByTier = vi.fn(async (_clinicId, tier) => {
      if (tier === 2) return 60;
      if (tier === 3) return 120;
      return 240;
    });
    ctx.listEscalationRecipientsByTier = vi.fn(async (_clinicId, _patientId, tier) => {
      if (tier === 2) return ['team-lead-1'];
      if (tier === 3) return ['governance-1'];
      return ['regulatory-1'];
    });

    const out = await processMhaReviewAlerts(t, ctx);
    expect(out.emitted).toBe(3); // tier-1(2) + tier-2(1)
    expect(ctx.emitCalls.filter((c) => c.payload.tier === 3)).toHaveLength(0);
    expect(ctx.emitCalls.filter((c) => c.payload.tier === 4)).toHaveLength(0);
  });
});
