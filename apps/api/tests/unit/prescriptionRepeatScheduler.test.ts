/**
 * BUG-372c — prescription-repeat alert scheduler.
 *
 * Pure-function unit tests for `processPrescriptionRepeatAlerts` and
 * its helpers. Live-DB exercise of the SELECT (with derived
 * consumed_count from erx_tokens JOIN) lives in
 * `apps/api/tests/integration/prescriptionRepeatAlerts.int.test.ts`.
 *
 * Active prescriptions with `repeats > 0` and `expires_at`
 * approaching require either a renewal review (T-7d/T-1d) or
 * urgent attention (T+overdue). Walk-out medication continuity
 * is a clinical-safety harm — abrupt stop of clozapine, lithium,
 * antipsychotics is dangerous.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  bucketForExpiresAt,
  dedupeKeyForPrescriptionRepeat,
  dedupeKeyForPrescriptionRepeatEscalation,
  isHighRiskDrugClass,
  isPrescriptionRepeatEscalationDue,
  severityForBucket,
  processPrescriptionRepeatAlerts,
  type PrescriptionRepeatContext,
  type PrescriptionRepeatRow,
  type PrescriptionRepeatBucket,
} from '../../src/jobs/schedulers/prescriptionRepeatScheduler';

const NOW = new Date('2026-04-26T15:30:00.000Z');

type EmitCall = Parameters<PrescriptionRepeatContext['emit']>[0];
type AuditCall = Parameters<PrescriptionRepeatContext['writeAuditLogRow']>[0];

function ymdOffset(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function row(overrides: Partial<PrescriptionRepeatRow> = {}): PrescriptionRepeatRow {
  return {
    prescription_id: '00000000-0000-0000-0000-000000000001',
    clinic_id: '00000000-0000-0000-0000-0000000000c1',
    patient_id: '00000000-0000-0000-0000-0000000000p1',
    generic_name: 'sertraline',
    brand_name: 'Zoloft',
    repeats: 5,
    consumed_count: 1,
    expires_at: ymdOffset(NOW, 7),
    status: 'active',
    prescribed_by_staff_id: '00000000-0000-0000-0000-0000000000s1',
    primary_clinician_id: '00000000-0000-0000-0000-0000000000s2',
    ...overrides,
  };
}

function buildCtx(
  rows: PrescriptionRepeatRow[],
): PrescriptionRepeatContext & { emitCalls: EmitCall[]; auditCalls: AuditCall[] } {
  const emitCalls: EmitCall[] = [];
  const auditCalls: AuditCall[] = [];
  return {
    listPrescriptionsApproachingRepeatDue: vi.fn(async () => rows),
    emit: vi.fn(async (input: EmitCall) => {
      emitCalls.push(input);
      return { ids: ['nid'], published: true };
    }),
    // BUG-589 default — both candidates active, no admin reassignment.
    // Existing TP-PR-* tests rely on this to preserve prescriber+primary
    // fan-out semantics.
    resolveActiveRecipients: vi.fn(async (_clinicId, prescriber, primary) => {
      const active: string[] = [];
      if (prescriber) active.push(prescriber);
      if (primary && primary !== prescriber) active.push(primary);
      return { active, reassignedToAdmin: null };
    }),
    // BUG-589 default — capture audit calls.
    writeAuditLogRow: vi.fn(async (input: AuditCall) => {
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

describe('BUG-372c — bucketForExpiresAt', () => {
  it('TP-PR-1: T-7d bucket when expires_at is 7 days away', () => {
    expect(bucketForExpiresAt(ymdOffset(NOW, 7), NOW)).toBe('T-7d');
  });

  it('TP-PR-2: T-1d bucket when expires_at is 1 day away', () => {
    expect(bucketForExpiresAt(ymdOffset(NOW, 1), NOW)).toBe('T-1d');
  });

  it('TP-PR-3: T+overdue when expires_at is in the past', () => {
    expect(bucketForExpiresAt(ymdOffset(NOW, -1), NOW)).toBe('T+overdue');
    expect(bucketForExpiresAt(ymdOffset(NOW, -7), NOW)).toBe('T+overdue');
  });

  it('TP-PR-4: null when outside any tier', () => {
    expect(bucketForExpiresAt(ymdOffset(NOW, 14), NOW)).toBeNull();
    expect(bucketForExpiresAt(ymdOffset(NOW, 6), NOW)).toBeNull();
    expect(bucketForExpiresAt(ymdOffset(NOW, 3), NOW)).toBeNull();
    expect(bucketForExpiresAt(ymdOffset(NOW, 2), NOW)).toBeNull();
    expect(bucketForExpiresAt(ymdOffset(NOW, 0), NOW)).toBeNull();
  });
});

describe('BUG-372c — isHighRiskDrugClass', () => {
  it('TP-PR-5a: clozapine generic_name matches', () => {
    expect(isHighRiskDrugClass({ generic_name: 'clozapine', brand_name: null })).toBe(true);
    expect(isHighRiskDrugClass({ generic_name: 'CLOZAPINE', brand_name: null })).toBe(true);
  });

  it('TP-PR-5b: clozapine brand_name (Clozaril, Clopine) matches', () => {
    expect(isHighRiskDrugClass({ generic_name: null, brand_name: 'Clozaril' })).toBe(true);
    expect(isHighRiskDrugClass({ generic_name: null, brand_name: 'Clopine' })).toBe(true);
  });

  it('TP-PR-5c: lithium generic_name matches', () => {
    expect(isHighRiskDrugClass({ generic_name: 'lithium carbonate', brand_name: null })).toBe(true);
  });

  it('TP-PR-5d: SSRIs / antidepressants do NOT match', () => {
    expect(isHighRiskDrugClass({ generic_name: 'sertraline', brand_name: 'Zoloft' })).toBe(false);
    expect(isHighRiskDrugClass({ generic_name: 'fluoxetine', brand_name: 'Prozac' })).toBe(false);
  });
});

describe('BUG-372c — severityForBucket', () => {
  it('TP-PR-6: clozapine + lithium promote ALL buckets to critical', () => {
    expect(severityForBucket('T-7d', true)).toBe('critical');
    expect(severityForBucket('T-1d', true)).toBe('critical');
    expect(severityForBucket('T+overdue', true)).toBe('critical');
  });

  it('TP-PR-7: standard drugs — warning at T-7d, critical at T-1d / T+overdue', () => {
    expect(severityForBucket('T-7d', false)).toBe('warning');
    expect(severityForBucket('T-1d', false)).toBe('critical');
    expect(severityForBucket('T+overdue', false)).toBe('critical');
  });
});

describe('BUG-372c — dedupeKeyForPrescriptionRepeat', () => {
  it('TP-PR-8: dedupe key encodes (prescription_id, staff_id, bucket)', () => {
    const k = dedupeKeyForPrescriptionRepeat('p1', 's1', 'T-7d');
    expect(k).toBe('prescription-repeat:p1:s1:T-7d');
  });

  it('TP-PR-9: dedupe key distinguishes buckets', () => {
    const buckets: PrescriptionRepeatBucket[] = ['T-7d', 'T-1d', 'T+overdue'];
    const keys = new Set(buckets.map((b) => dedupeKeyForPrescriptionRepeat('p1', 's1', b)));
    expect(keys.size).toBe(3);
  });

  it('TP-PR-9b: tier-2 escalation key uses distinct namespace + fired-day', () => {
    const k = dedupeKeyForPrescriptionRepeatEscalation('p1', 's1', 'T-1d', NOW);
    expect(k).toBe('prescription-repeat-escalation:p1:s1:T-1d:fired-day:2026-04-26');
  });
});

describe('BUG-589-FOLLOWUP — escalation due predicate', () => {
  it('TP-PR-9c: escalation due at/after local threshold minutes', () => {
    expect(isPrescriptionRepeatEscalationDue(new Date('2026-04-26T00:31:00.000Z'), 300)).toBe(true);
  });

  it('TP-PR-9d: escalation not due before local threshold minutes', () => {
    expect(isPrescriptionRepeatEscalationDue(new Date('2026-04-25T14:10:00.000Z'), 30)).toBe(false);
  });
});

describe('BUG-372c — processPrescriptionRepeatAlerts', () => {
  it('TP-PR-10: emits to BOTH prescribed_by_staff_id AND primary_clinician_id when distinct', async () => {
    const r = row({
      expires_at: ymdOffset(NOW, 7),
      prescribed_by_staff_id: 'sA',
      primary_clinician_id: 'sB',
    });
    const ctx = buildCtx([r]);
    const out = await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(2);
    const userIds = ctx.emitCalls.map((c) => c.userId).sort();
    expect(userIds).toEqual(['sA', 'sB']);
  });

  it('TP-PR-11: emits ONCE when prescriber === primary_clinician', async () => {
    const r = row({
      expires_at: ymdOffset(NOW, 7),
      prescribed_by_staff_id: 'sX',
      primary_clinician_id: 'sX',
    });
    const ctx = buildCtx([r]);
    const out = await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(out.emitted).toBe(1);
  });

  it('TP-PR-12: skips rows whose expires_at is outside any bucket window', async () => {
    const r = row({ expires_at: ymdOffset(NOW, 3) });
    const ctx = buildCtx([r]);
    const out = await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
  });

  it('TP-PR-13: skips when repeats=0', async () => {
    const r = row({ expires_at: ymdOffset(NOW, 7), repeats: 0 });
    const ctx = buildCtx([r]);
    const out = await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
  });

  it('TP-PR-14: skips when consumed_count >= repeats (exhausted)', async () => {
    const r = row({ expires_at: ymdOffset(NOW, 7), repeats: 3, consumed_count: 3 });
    const ctx = buildCtx([r]);
    const out = await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
  });

  it('TP-PR-15: clozapine prescription gets severity critical even at T-7d', async () => {
    const r = row({
      expires_at: ymdOffset(NOW, 7),
      generic_name: 'clozapine',
      brand_name: 'Clozaril',
      prescribed_by_staff_id: 'sX',
      primary_clinician_id: 'sX',
    });
    const ctx = buildCtx([r]);
    await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(ctx.emitCalls[0].severity).toBe('critical');
  });

  it('TP-PR-16: standard drug at T-7d gets severity warning', async () => {
    const r = row({
      expires_at: ymdOffset(NOW, 7),
      generic_name: 'sertraline',
      prescribed_by_staff_id: 'sX',
      primary_clinician_id: 'sX',
    });
    const ctx = buildCtx([r]);
    await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(ctx.emitCalls[0].severity).toBe('warning');
  });

  it('TP-PR-17: per-row failure does not stop subsequent rows', async () => {
    const rows = [
      row({ prescription_id: 'p1', expires_at: ymdOffset(NOW, 7) }),
      row({ prescription_id: 'p2', expires_at: ymdOffset(NOW, 7) }),
    ];
    const ctx = buildCtx(rows);
    let nth = 0;
    ctx.emit = vi.fn(async (input) => {
      nth++;
      if (nth === 1) throw new Error('boom');
      ctx.emitCalls.push(input);
      return { ids: ['nid'], published: true };
    });
    const out = await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(out.processed).toBe(2);
    expect(out.errors).toBeGreaterThanOrEqual(1);
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('TP-PR-18: top-level listPrescriptionsApproachingRepeatDue failure → zeroed counts', async () => {
    const ctx = buildCtx([]);
    ctx.listPrescriptionsApproachingRepeatDue = vi.fn(async () => { throw new Error('db down'); });
    const out = await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(out.processed).toBe(0);
    expect(out.emitted).toBe(0);
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('TP-PR-19: zero-row tick emits structured WARN log', async () => {
    const ctx = buildCtx([]);
    await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it('TP-PR-20: emit shape — payload carries prescription_id + bucket + drug_class', async () => {
    const r = row({
      expires_at: ymdOffset(NOW, 7),
      generic_name: 'lithium carbonate',
      prescribed_by_staff_id: 'sX',
      primary_clinician_id: 'sX',
    });
    const ctx = buildCtx([r]);
    await processPrescriptionRepeatAlerts(NOW, ctx);
    const emit = ctx.emitCalls[0];
    expect(emit.category).toBe('prescription-repeat');
    expect(emit.payload.prescription_id).toBe(r.prescription_id);
    expect(emit.payload.bucket).toBe('T-7d');
    expect(emit.payload.high_risk_drug_class).toBe(true);
    expect(emit.actionUrl).toContain(r.patient_id);
  });
});

describe('BUG-591 — T-3d intermediate tier for high-risk drugs', () => {
  it('TP-PR-24: high-risk drug + 3 days out → T-3d bucket', () => {
    expect(bucketForExpiresAt(ymdOffset(NOW, 3), NOW, true)).toBe('T-3d');
  });

  it('TP-PR-25: standard drug + 3 days out → null (no T-3d for standard)', () => {
    expect(bucketForExpiresAt(ymdOffset(NOW, 3), NOW, false)).toBeNull();
  });

  it('TP-PR-26: bucketForExpiresAt highRisk default false (backward-compat)', () => {
    // Pre-BUG-591 callers passed only 2 args; default highRisk=false
    // means standard 3-tier behaviour preserved.
    expect(bucketForExpiresAt(ymdOffset(NOW, 3), NOW)).toBeNull();
  });

  it('TP-PR-27: severityForBucket T-3d high-risk → critical', () => {
    expect(severityForBucket('T-3d', true)).toBe('critical');
  });

  it('TP-PR-28: clozapine prescription at T-3d fires critical alert', async () => {
    const r = row({
      generic_name: 'clozapine',
      brand_name: 'Clopine',
      expires_at: ymdOffset(NOW, 3),
    });
    const ctx = buildCtx([r]);
    const out = await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(out.emitted).toBe(2); // prescriber + primary
    const emit = ctx.emitCalls[0];
    expect(emit.severity).toBe('critical');
    expect(emit.payload.bucket).toBe('T-3d');
    expect(emit.payload.high_risk_drug_class).toBe(true);
    expect(emit.title).toContain('expires in 3 days');
  });

  it('TP-PR-29: standard drug at T-3d does NOT fire (would be 6-day gap)', async () => {
    const r = row({
      generic_name: 'sertraline',
      brand_name: 'Zoloft',
      expires_at: ymdOffset(NOW, 3),
    });
    const ctx = buildCtx([r]);
    const out = await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(out.emitted).toBe(0); // standard drugs skip T-3d
  });

  it('TP-PR-30: depot-LAI (paliperidone palmitate) at T-3d fires critical', async () => {
    const r = row({
      generic_name: 'paliperidone palmitate',
      brand_name: 'Invega Sustenna',
      expires_at: ymdOffset(NOW, 3),
    });
    const ctx = buildCtx([r]);
    const out = await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(out.emitted).toBe(2);
    expect(ctx.emitCalls[0].severity).toBe('critical');
    expect(ctx.emitCalls[0].payload.bucket).toBe('T-3d');
  });

  it('TP-PR-31: high-risk T-3d title prefix matches "High-risk medication"', async () => {
    const r = row({
      generic_name: 'lithium',
      expires_at: ymdOffset(NOW, 3),
    });
    const ctx = buildCtx([r]);
    await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(ctx.emitCalls[0].title).toBe(`High-risk medication expires in 3 days — lithium`);
  });
});

describe('BUG-589 — resolveActiveRecipients integration + AHPRA audit_log', () => {
  it('TP-PR-32: BOTH inactive → admin fallback emits + WARN log + audit_log row', async () => {
    const r = row({
      generic_name: 'sertraline',
      expires_at: ymdOffset(NOW, 7),
      prescribed_by_staff_id: 'inactive-A',
      primary_clinician_id: 'inactive-B',
    });
    const ctx = buildCtx([r]);
    ctx.resolveActiveRecipients = vi.fn(async () => ({
      active: ['admin-X'],
      reassignedToAdmin: 'admin-X',
    }));
    const out = await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(out.emitted).toBe(1);
    expect(ctx.emitCalls[0].userId).toBe('admin-X');
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'PRESCRIPTION_REPEAT_RECIPIENT_REASSIGNED_TO_ADMIN',
        adminStaffId: 'admin-X',
      }),
      expect.any(String),
    );
    // AHPRA Standard 1 immutable trail.
    expect(ctx.auditCalls).toHaveLength(1);
    expect(ctx.auditCalls[0]).toMatchObject({
      action: 'PRESCRIPTION_REPEAT_RECIPIENT_REASSIGNED',
      prescriptionId: r.prescription_id,
      clinicId: r.clinic_id,
      metadata: expect.objectContaining({
        prescribed_by_staff_id: 'inactive-A',
        primary_clinician_id: 'inactive-B',
        admin_staff_id: 'admin-X',
        reason: 'both_originals_inactive',
        system_actor: 'prescription-repeat-scheduler',
      }),
    });
  });

  it('TP-PR-33: BOTH inactive AND no admin → ERROR log + audit_log row (silent-drop closure)', async () => {
    const r = row({
      generic_name: 'clozapine',
      expires_at: ymdOffset(NOW, 7),
      prescribed_by_staff_id: 'inactive-A',
      primary_clinician_id: 'inactive-B',
    });
    const ctx = buildCtx([r]);
    ctx.resolveActiveRecipients = vi.fn(async () => ({
      active: [],
      reassignedToAdmin: null,
    }));
    const out = await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(out.emitted).toBe(0);
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'PRESCRIPTION_REPEAT_NO_RECIPIENT_AVAILABLE',
        prescriptionId: r.prescription_id,
        highRiskDrugClass: true,
      }),
      expect.stringContaining('dropped alert'),
    );
    expect(ctx.auditCalls).toHaveLength(1);
    expect(ctx.auditCalls[0]).toMatchObject({
      action: 'PRESCRIPTION_REPEAT_NO_RECIPIENT_AVAILABLE',
      metadata: expect.objectContaining({
        reason: 'no_admin_configured',
        system_actor: 'prescription-repeat-scheduler',
        high_risk_drug_class: true,
      }),
    });
  });

  it('TP-PR-34: ONE inactive (primary) → emits to active prescriber only, no WARN, no audit', async () => {
    const r = row({
      expires_at: ymdOffset(NOW, 7),
      prescribed_by_staff_id: 'sA',
      primary_clinician_id: 'inactive-B',
    });
    const ctx = buildCtx([r]);
    ctx.resolveActiveRecipients = vi.fn(async () => ({
      active: ['sA'],
      reassignedToAdmin: null,
    }));
    const out = await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(out.emitted).toBe(1);
    expect(ctx.emitCalls[0].userId).toBe('sA');
    expect(ctx.auditCalls).toHaveLength(0);
  });

  it('TP-PR-35: silent-drop on critical bucket escalates to tier-2 recipients when enabled', async () => {
    const r = row({
      generic_name: 'clozapine',
      expires_at: ymdOffset(NOW, 1),
      prescribed_by_staff_id: 'inactive-A',
      primary_clinician_id: 'inactive-B',
    });
    const ctx = buildCtx([r]);
    ctx.resolveActiveRecipients = vi.fn(async () => ({
      active: [],
      reassignedToAdmin: null,
    }));
    ctx.getEscalationThreshold = vi.fn(async () => 30);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-A']);
    const out = await processPrescriptionRepeatAlerts(NOW, ctx);
    expect(out.emitted).toBe(1);
    expect(ctx.emitCalls[0].userId).toBe('team-lead-A');
    expect(ctx.emitCalls[0].payload.tier).toBe(2);
    expect(ctx.emitCalls[0].dedupeKey).toMatch(/^prescription-repeat-escalation:/);
  });
});
