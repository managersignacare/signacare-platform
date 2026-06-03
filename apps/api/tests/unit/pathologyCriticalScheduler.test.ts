/**
 * BUG-372a — pathology critical-result alert scheduler.
 *
 * Pure-function unit tests for `processPathologyCriticalAlerts` and its
 * helpers. The scheduler tick itself (`cron.schedule(...)`) and the
 * actual DB query / notification insert live behind an injected
 * context, so these tests need no live DB / no Redis / no time-travel
 * — they exercise the decision logic and fan-out shape directly.
 *
 * Live-DB exercise of the helper SELECT + notifications insert lives
 * in `apps/api/tests/integration/pathologyCriticalAlerts.int.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isCriticalRow,
  dedupeKeyForPathologyAlert,
  dedupeKeyForPathologyEscalation,
  dedupeKeyForPathologyEscalationTier,
  isEscalationDue,
  processPathologyCriticalAlerts,
  type PathologyAlertEmitInput,
  type PathologyAlertContext,
  type PathologyAlertRow,
} from '../../src/jobs/schedulers/pathologyCriticalScheduler';

const NOW = new Date('2026-04-26T15:30:00.000Z');
type PathologyAuditCall = Parameters<
  NonNullable<PathologyAlertContext['writeAuditLogRow']>
>[0];

function row(overrides: Partial<PathologyAlertRow> = {}): PathologyAlertRow {
  return {
    result_id: '00000000-0000-0000-0000-000000000001',
    clinic_id: '00000000-0000-0000-0000-0000000000c1',
    patient_id: '00000000-0000-0000-0000-0000000000p1',
    test_name: 'Sodium',
    abnormal_flag: 'critical_high',
    is_critical: false,
    result_date: '2026-04-26',
    // Default: 2 hours old so per-clinic threshold (default 30 min) lets
    // the row through. Tests overriding `created_at` exercise the
    // per-clinic-threshold filter directly.
    created_at: new Date('2026-04-26T13:30:00.000Z'),
    primary_clinician_id: '00000000-0000-0000-0000-0000000000s1',
    ordered_by_id: '00000000-0000-0000-0000-0000000000s2',
    ...overrides,
  };
}

function buildCtx(rows: PathologyAlertRow[]): PathologyAlertContext & {
  emitCalls: PathologyAlertEmitInput[];
  auditCalls: PathologyAuditCall[];
} {
  const emitCalls: PathologyAlertEmitInput[] = [];
  const auditCalls: PathologyAuditCall[] = [];
  return {
    listUnacknowledgedCritical: vi.fn(async () => rows),
    emit: vi.fn(async (input) => {
      emitCalls.push(input);
      return { ids: ['nid'], published: true };
    }),
    getThreshold: vi.fn(async () => 30),
    // BUG-578 cycle-2 absorb default: 120 minutes (matches
    // DEFAULT_THRESHOLDS.pathology_escalation_minutes).
    getEscalationThreshold: vi.fn(async () => 120),
    // BUG-577 default — both candidates active, no admin reassignment.
    // Existing TP-PA-* tests rely on this default to preserve
    // primary+orderer fan-out semantics.
    resolveActiveRecipients: vi.fn(async (_clinicId, primary, orderer) => {
      const active: string[] = [];
      if (primary) active.push(primary);
      if (orderer && orderer !== primary) active.push(orderer);
      return { active, reassignedToAdmin: null };
    }),
    // BUG-578 default — no escalation tier in default ctx; tests that
    // exercise escalation override this method explicitly.
    listEscalationRecipients: vi.fn(async () => []),
    // BUG-577 cycle-2 absorb default: capture audit calls.
    writeAuditLogRow: vi.fn(async (input: PathologyAuditCall) => {
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

describe('BUG-372a — isCriticalRow', () => {
  it('TP-PA-1a: is_critical=true → critical regardless of abnormal_flag', () => {
    expect(isCriticalRow({ is_critical: true, abnormal_flag: 'normal' })).toBe(true);
    expect(isCriticalRow({ is_critical: true, abnormal_flag: 'low' })).toBe(true);
  });

  it('TP-PA-1b: abnormal_flag in (critical_high, critical_low) → critical', () => {
    expect(isCriticalRow({ is_critical: false, abnormal_flag: 'critical_high' })).toBe(true);
    expect(isCriticalRow({ is_critical: false, abnormal_flag: 'critical_low' })).toBe(true);
  });

  it('TP-PA-1c: abnormal-but-not-critical (low/high/abnormal) → NOT critical', () => {
    expect(isCriticalRow({ is_critical: false, abnormal_flag: 'low' })).toBe(false);
    expect(isCriticalRow({ is_critical: false, abnormal_flag: 'high' })).toBe(false);
    expect(isCriticalRow({ is_critical: false, abnormal_flag: 'abnormal' })).toBe(false);
    expect(isCriticalRow({ is_critical: false, abnormal_flag: 'normal' })).toBe(false);
  });
});

describe('BUG-372a — dedupeKeyForPathologyAlert', () => {
  it('TP-PA-2: dedupe key encodes (resultId, staffId, fired-day) — bumps daily', () => {
    const k1 = dedupeKeyForPathologyAlert('r1', 's1', new Date('2026-04-26T01:00:00Z'));
    const k2 = dedupeKeyForPathologyAlert('r1', 's1', new Date('2026-04-26T23:59:00Z'));
    const k3 = dedupeKeyForPathologyAlert('r1', 's1', new Date('2026-04-27T00:00:00Z'));
    expect(k1).toBe('pathology-critical:r1:s1:fired-day:2026-04-26');
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it('TP-PA-2b: dedupe key distinguishes result + staff', () => {
    const a = dedupeKeyForPathologyAlert('r1', 's1', NOW);
    const b = dedupeKeyForPathologyAlert('r2', 's1', NOW);
    const c = dedupeKeyForPathologyAlert('r1', 's2', NOW);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });
});

describe('BUG-372a — processPathologyCriticalAlerts', () => {
  it('TP-PA-3: emits to BOTH primary_clinician_id AND ordered_by_id when distinct', async () => {
    const r = row({ primary_clinician_id: 'sA', ordered_by_id: 'sB' });
    const ctx = buildCtx([r]);
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(2);
    const userIds = ctx.emitCalls.map((c) => c.userId).sort();
    expect(userIds).toEqual(['sA', 'sB']);
  });

  it('TP-PA-4: collapses to ONE emit when primary_clinician_id === ordered_by_id', async () => {
    const r = row({ primary_clinician_id: 'sX', ordered_by_id: 'sX' });
    const ctx = buildCtx([r]);
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(out.emitted).toBe(1);
  });

  it('TP-PA-5: skips primary_clinician=null path but still emits to ordered_by_id', async () => {
    const r = row({ primary_clinician_id: null, ordered_by_id: 'sB' });
    const ctx = buildCtx([r]);
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(out.emitted).toBe(1);
    expect(ctx.emitCalls[0]?.userId).toBe('sB');
  });

  it('TP-PA-6: emit shape — severity=critical, category=pathology, dedupeKey present', async () => {
    const r = row({ primary_clinician_id: 'sA', ordered_by_id: 'sA' });
    const ctx = buildCtx([r]);
    await processPathologyCriticalAlerts(NOW, ctx);
    const emit = ctx.emitCalls[0];
    expect(emit.severity).toBe('critical');
    expect(emit.category).toBe('pathology');
    expect(emit.dedupeKey).toBe('pathology-critical:00000000-0000-0000-0000-000000000001:sA:fired-day:2026-04-26');
    expect(emit.actionUrl).toBe('/patients/00000000-0000-0000-0000-0000000000p1/pathology/00000000-0000-0000-0000-000000000001');
  });

  it('TP-PA-7: per-row failure does not stop subsequent rows', async () => {
    const r1 = row({ result_id: 'r1' });
    const r2 = row({ result_id: 'r2' });
    const ctx = buildCtx([r1, r2]);
    let nthCall = 0;
    ctx.emit = vi.fn(async (input) => {
      nthCall++;
      if (nthCall === 1) throw new Error('boom');
      ctx.emitCalls.push(input);
      return { ids: ['nid'], published: true };
    });
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(out.processed).toBe(2);
    expect(out.errors).toBeGreaterThanOrEqual(1);
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('TP-PA-8: top-level listUnacknowledgedCritical failure → logs but returns zeroed counts', async () => {
    const ctx = buildCtx([]);
    ctx.listUnacknowledgedCritical = vi.fn(async () => { throw new Error('db down'); });
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(out.processed).toBe(0);
    expect(out.emitted).toBe(0);
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('TP-PA-9: defensive isCriticalRow guard — non-critical rows are silently skipped', async () => {
    const okRow = row({ result_id: 'rx', is_critical: false, abnormal_flag: 'critical_high' });
    const bogusRow = row({ result_id: 'rb', is_critical: false, abnormal_flag: 'normal' });
    const ctx = buildCtx([okRow, bogusRow]);
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(out.processed).toBe(2);
    // Only okRow's two recipients should emit; bogus row falls through guard
    expect(out.emitted).toBe(2);
  });

  it('TP-PA-10: per-clinic threshold honoured — getThreshold IS called and gates emission', async () => {
    // Row is 10 minutes old; clinic threshold is 30 minutes by default.
    // Expectation: NO emission.
    const r = row({ created_at: new Date(NOW.getTime() - 10 * 60_000) });
    const ctx = buildCtx([r]);
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(ctx.getThreshold).toHaveBeenCalledWith(r.clinic_id);
    expect(out.processed).toBe(1);
    expect(out.emitted).toBe(0);
  });

  it('TP-PA-11: per-clinic threshold non-default — 60-min clinic skips a 45-min-old row', async () => {
    const r = row({ created_at: new Date(NOW.getTime() - 45 * 60_000) });
    const ctx = buildCtx([r]);
    ctx.getThreshold = vi.fn(async () => 60);
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(ctx.getThreshold).toHaveBeenCalled();
    expect(out.emitted).toBe(0);
  });

  it('TP-PA-12: per-clinic threshold cache — same clinic resolved once per tick', async () => {
    const r1 = row({ result_id: 'rA', created_at: new Date(NOW.getTime() - 60 * 60_000) });
    const r2 = row({ result_id: 'rB', created_at: new Date(NOW.getTime() - 60 * 60_000) });
    const ctx = buildCtx([r1, r2]);
    await processPathologyCriticalAlerts(NOW, ctx);
    // Both rows share clinic_id; getThreshold should be invoked once.
    expect(ctx.getThreshold).toHaveBeenCalledTimes(1);
  });
});

describe('BUG-578 — dedupeKeyForPathologyEscalation', () => {
  it('TP-PA-13: escalation dedupe key has distinct prefix from tier-1', () => {
    const e = dedupeKeyForPathologyEscalation('r1', 's1', NOW);
    const t = dedupeKeyForPathologyAlert('r1', 's1', NOW);
    expect(e).toBe('pathology-critical-escalation:r1:s1:fired-day:2026-04-26');
    expect(t).toBe('pathology-critical:r1:s1:fired-day:2026-04-26');
    expect(e).not.toBe(t);
  });

  it('TP-PA-14: escalation key bumps daily (UTC)', () => {
    const k1 = dedupeKeyForPathologyEscalation('r1', 's1', new Date('2026-04-26T01:00:00Z'));
    const k2 = dedupeKeyForPathologyEscalation('r1', 's1', new Date('2026-04-27T00:00:00Z'));
    expect(k1).not.toBe(k2);
  });

  it('TP-PA-14b (BUG-585-FOLLOWUP): tier-specific escalation namespaces are distinct', () => {
    const k2 = dedupeKeyForPathologyEscalationTier('r1', 's1', 2, NOW);
    const k3 = dedupeKeyForPathologyEscalationTier('r1', 's1', 3, NOW);
    const k4 = dedupeKeyForPathologyEscalationTier('r1', 's1', 4, NOW);
    expect(k2).toBe('pathology-critical-escalation:r1:s1:fired-day:2026-04-26');
    expect(k3).toBe('pathology-critical-governance-escalation:r1:s1:fired-day:2026-04-26');
    expect(k4).toBe('pathology-critical-regulatory-escalation:r1:s1:fired-day:2026-04-26');
  });
});

describe('BUG-578 — isEscalationDue (per-clinic threshold)', () => {
  it('TP-PA-15: T+0 not due (default 120 min threshold)', () => {
    expect(isEscalationDue(NOW, NOW, 120)).toBe(false);
  });
  it('TP-PA-15b: T+1h59 not due (default 120 min threshold)', () => {
    expect(
      isEscalationDue(new Date(NOW.getTime() - (1 * 3600 + 59 * 60) * 1000), NOW, 120),
    ).toBe(false);
  });
  it('TP-PA-15c: T+2h DUE — boundary inclusive (default 120 min)', () => {
    expect(isEscalationDue(new Date(NOW.getTime() - 2 * 3600 * 1000), NOW, 120)).toBe(true);
  });
  it('TP-PA-15d: T+5h DUE (default 120 min)', () => {
    expect(isEscalationDue(new Date(NOW.getTime() - 5 * 3600 * 1000), NOW, 120)).toBe(true);
  });
  it('TP-PA-15e: per-clinic 30-min threshold — T+45min DUE (24/7 inpatient)', () => {
    expect(isEscalationDue(new Date(NOW.getTime() - 45 * 60_000), NOW, 30)).toBe(true);
  });
  it('TP-PA-15f: per-clinic 240-min threshold — T+3h NOT due (after-hours small clinic)', () => {
    expect(isEscalationDue(new Date(NOW.getTime() - 3 * 3600_000), NOW, 240)).toBe(false);
  });
});

describe('BUG-577 — resolveActiveRecipients integration + AHPRA audit_log', () => {
  it('TP-PA-16: BOTH inactive → admin fallback emits + WARN log + audit_log row', async () => {
    const r = row({ primary_clinician_id: 'inactive-A', ordered_by_id: 'inactive-B' });
    const ctx = buildCtx([r]);
    ctx.resolveActiveRecipients = vi.fn(async () => ({
      active: ['admin-X'],
      reassignedToAdmin: 'admin-X',
    }));
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(out.emitted).toBe(1);
    expect(ctx.emitCalls[0]?.userId).toBe('admin-X');
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'PATHOLOGY_CRITICAL_RECIPIENT_REASSIGNED_TO_ADMIN',
        adminStaffId: 'admin-X',
      }),
      expect.any(String),
    );
    // BUG-577 cycle-2 absorb (L4 #3 — AHPRA Standard 1 immutability):
    // pino WARN paired with audit_log row for durable forensic trail.
    expect(ctx.auditCalls).toHaveLength(1);
    expect(ctx.auditCalls[0]).toMatchObject({
      action: 'CRITICAL_RECIPIENT_REASSIGNED',
      resultId: r.result_id,
      clinicId: r.clinic_id,
      metadata: expect.objectContaining({
        primary_clinician_id: 'inactive-A',
        orderer_id: 'inactive-B',
        admin_staff_id: 'admin-X',
        reason: 'both_originals_inactive',
      }),
    });
  });

  it('TP-PA-17: ONE inactive (orderer) → emits to active primary only, no WARN, no audit', async () => {
    const r = row({ primary_clinician_id: 'sA', ordered_by_id: 'inactive-B' });
    const ctx = buildCtx([r]);
    ctx.resolveActiveRecipients = vi.fn(async () => ({
      active: ['sA'],
      reassignedToAdmin: null,
    }));
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(out.emitted).toBe(1);
    expect(ctx.emitCalls[0]?.userId).toBe('sA');
    expect(ctx.logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'PATHOLOGY_CRITICAL_RECIPIENT_REASSIGNED_TO_ADMIN' }),
      expect.anything(),
    );
    expect(ctx.auditCalls).toHaveLength(0);
  });

  it('TP-PA-18: BOTH inactive AND no admin configured → ERROR log + audit_log row (silent-drop closure)', async () => {
    // BUG-577 cycle-2 absorb (L4 #2 — silent-drop closure): the
    // worst-case scenario (critical pathology result with NO recipient)
    // MUST emit ERROR-level pino + audit_log row so ops + AHPRA review
    // have a durable trail. Pre-cycle-2 this case dropped silently.
    const r = row({ primary_clinician_id: 'inactive-A', ordered_by_id: 'inactive-B' });
    const ctx = buildCtx([r]);
    ctx.resolveActiveRecipients = vi.fn(async () => ({
      active: [],
      reassignedToAdmin: null, // no clinic admin configured
    }));
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(out.emitted).toBe(0);
    // ERROR pino log fires.
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'PATHOLOGY_CRITICAL_NO_RECIPIENT_AVAILABLE',
        resultId: r.result_id,
        primaryClinicianId: 'inactive-A',
        ordererId: 'inactive-B',
      }),
      expect.stringContaining('dropped alert'),
    );
    // audit_log row written for AHPRA Standard 1 immutable trail.
    expect(ctx.auditCalls).toHaveLength(1);
    expect(ctx.auditCalls[0]).toMatchObject({
      action: 'CRITICAL_NO_RECIPIENT_AVAILABLE',
      resultId: r.result_id,
      clinicId: r.clinic_id,
      metadata: expect.objectContaining({
        primary_clinician_id: 'inactive-A',
        orderer_id: 'inactive-B',
        reason: 'no_admin_configured',
      }),
    });
    // No reassignment WARN (correct — no reassignment happened).
    expect(ctx.logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'PATHOLOGY_CRITICAL_RECIPIENT_REASSIGNED_TO_ADMIN' }),
      expect.anything(),
    );
  });
});

describe('BUG-578 — tier-2 escalation integration', () => {
  it('TP-PA-19: T+1h (under 2h) → tier-2 NOT fired', async () => {
    const r = row({ created_at: new Date(NOW.getTime() - 60 * 60_000) }); // 1h old
    const ctx = buildCtx([r]);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1', 'admin-X']);
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    // Tier-1 fires (2h > 30 min default threshold). Tier-2 does NOT.
    expect(out.emitted).toBe(2);
    expect(ctx.listEscalationRecipients).not.toHaveBeenCalled();
    // No emit carries tier=2.
    const tiers = ctx.emitCalls.map((c) => c.payload.tier).sort();
    expect(tiers).toEqual([1, 1]);
  });

  it('TP-PA-20: T+3h (over 2h) → tier-2 fires to team-leads + admin', async () => {
    const r = row({ created_at: new Date(NOW.getTime() - 3 * 3600_000) }); // 3h old
    const ctx = buildCtx([r]);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1', 'admin-X']);
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    // Tier-1: 2 emits (primary + orderer). Tier-2: 2 emits (team-lead-1 + admin-X).
    expect(out.emitted).toBe(4);
    const tier2Emits = ctx.emitCalls.filter((c) => c.payload.tier === 2);
    expect(tier2Emits).toHaveLength(2);
    expect(tier2Emits[0].dedupeKey).toMatch(/^pathology-critical-escalation:/);
    expect(tier2Emits[0].title).toContain('[ESCALATION]');
  });

  it('TP-PA-21: tier-2 dedupes against tier-1 — staff already on tier-1 not re-notified', async () => {
    const r = row({
      primary_clinician_id: 'sA',
      ordered_by_id: 'sB',
      created_at: new Date(NOW.getTime() - 3 * 3600_000),
    });
    const ctx = buildCtx([r]);
    // Escalation list includes 'sA' (already tier-1) + 'team-lead-1' + 'admin-X'.
    ctx.listEscalationRecipients = vi.fn(async () => ['sA', 'team-lead-1', 'admin-X']);
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    // Tier-1: 2 (sA, sB). Tier-2: 2 (team-lead-1, admin-X) — sA filtered out.
    expect(out.emitted).toBe(4);
    const tier2UserIds = ctx.emitCalls
      .filter((c) => c.payload.tier === 2)
      .map((c) => c.userId)
      .sort();
    expect(tier2UserIds).toEqual(['admin-X', 'team-lead-1']);
  });

  it('TP-PA-22: tier-2 with empty escalation list → no tier-2 emits, no error', async () => {
    const r = row({ created_at: new Date(NOW.getTime() - 3 * 3600_000) });
    const ctx = buildCtx([r]);
    ctx.listEscalationRecipients = vi.fn(async () => []);
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(out.emitted).toBe(2); // tier-1 only
    expect(ctx.listEscalationRecipients).toHaveBeenCalledWith(r.clinic_id, r.patient_id);
  });

  it('TP-PA-23: per-clinic 30-min escalation threshold — T+45min triggers tier-2', async () => {
    // 24/7 inpatient ward configures pathology_escalation_minutes=30.
    // A 45-minute-old result should fire BOTH tier-1 (default 30-min)
    // AND tier-2 (clinic-specific 30-min escalation).
    const r = row({ created_at: new Date(NOW.getTime() - 45 * 60_000) });
    const ctx = buildCtx([r]);
    ctx.getEscalationThreshold = vi.fn(async () => 30);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1']);
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(ctx.getEscalationThreshold).toHaveBeenCalledWith(r.clinic_id);
    // Tier-1: 2 (primary + orderer); Tier-2: 1 (team-lead-1).
    expect(out.emitted).toBe(3);
    const tier2 = ctx.emitCalls.filter((c) => c.payload.tier === 2);
    expect(tier2).toHaveLength(1);
  });

  it('TP-PA-24: per-clinic 240-min escalation threshold — T+3h does NOT trigger tier-2', async () => {
    // After-hours small clinic configures
    // pathology_escalation_minutes=240. A 3-hour-old result fires
    // tier-1 only — tier-2 holds until T+4h.
    const r = row({ created_at: new Date(NOW.getTime() - 3 * 3600_000) });
    const ctx = buildCtx([r]);
    ctx.getEscalationThreshold = vi.fn(async () => 240);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1']);
    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(ctx.getEscalationThreshold).toHaveBeenCalledWith(r.clinic_id);
    expect(out.emitted).toBe(2); // tier-1 only
    expect(ctx.listEscalationRecipients).not.toHaveBeenCalled();
  });

  it('TP-PA-25: escalation-threshold cache — same clinic resolved once per tick', async () => {
    const r1 = row({
      result_id: 'rA',
      created_at: new Date(NOW.getTime() - 3 * 3600_000),
    });
    const r2 = row({
      result_id: 'rB',
      created_at: new Date(NOW.getTime() - 3 * 3600_000),
    });
    const ctx = buildCtx([r1, r2]);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1']);
    await processPathologyCriticalAlerts(NOW, ctx);
    // Both rows share clinic_id; getEscalationThreshold should be invoked once.
    expect(ctx.getEscalationThreshold).toHaveBeenCalledTimes(1);
  });
});

describe('BUG-578 cycle-2 absorb-2 (L4 CONCERN-2) — dynamic threshold label in tier-2 body', () => {
  it('TP-PA-26: default 120-min threshold renders "2h+" in title + body', async () => {
    const r = row({ created_at: new Date(NOW.getTime() - 3 * 3600_000) });
    const ctx = buildCtx([r]);
    // buildCtx default getEscalationThreshold returns 120.
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1']);
    await processPathologyCriticalAlerts(NOW, ctx);
    const tier2 = ctx.emitCalls.find((c) => c.payload.tier === 2);
    expect(tier2).toBeDefined();
    if (!tier2) throw new Error('expected tier-2 emit');
    expect(tier2.title).toBe(`[ESCALATION] Critical pathology unacknowledged 2h+ — ${r.test_name}`);
    expect(tier2.body).toContain('unacknowledged for 2h+');
    expect(tier2.body).toContain('verify the primary clinician was reached');
  });

  it('TP-PA-27: per-clinic 30-min threshold renders "30min+" (NOT "2h+")', async () => {
    // BUG-578 cycle-2 absorb-2 — pre-fix this case rendered "2h+"
    // even though threshold was 30 min — clinical misinformation.
    const r = row({ created_at: new Date(NOW.getTime() - 45 * 60_000) });
    const ctx = buildCtx([r]);
    ctx.getEscalationThreshold = vi.fn(async () => 30);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1']);
    await processPathologyCriticalAlerts(NOW, ctx);
    const tier2 = ctx.emitCalls.find((c) => c.payload.tier === 2);
    expect(tier2).toBeDefined();
    if (!tier2) throw new Error('expected tier-2 emit');
    expect(tier2.title).toContain('30min+');
    expect(tier2.title).not.toContain('2h+');
    expect(tier2.body).toContain('unacknowledged for 30min+');
  });

  it('TP-PA-28: per-clinic 240-min threshold renders "4h+" (divisible-by-60 path)', async () => {
    const r = row({ created_at: new Date(NOW.getTime() - 5 * 3600_000) });
    const ctx = buildCtx([r]);
    ctx.getEscalationThreshold = vi.fn(async () => 240);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1']);
    await processPathologyCriticalAlerts(NOW, ctx);
    const tier2 = ctx.emitCalls.find((c) => c.payload.tier === 2);
    expect(tier2).toBeDefined();
    if (!tier2) throw new Error('expected tier-2 emit');
    expect(tier2.title).toContain('4h+');
    expect(tier2.title).not.toContain('240min+');
    expect(tier2.body).toContain('unacknowledged for 4h+');
  });

  it('TP-PA-29: per-clinic 90-min threshold (non-divisible-by-60) renders "90min+"', async () => {
    // 90 min is not divisible by 60 with zero remainder, so the
    // helper formats as minutes — verifies the non-hour-boundary path.
    const r = row({ created_at: new Date(NOW.getTime() - 2 * 3600_000) });
    const ctx = buildCtx([r]);
    ctx.getEscalationThreshold = vi.fn(async () => 90);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-1']);
    await processPathologyCriticalAlerts(NOW, ctx);
    const tier2 = ctx.emitCalls.find((c) => c.payload.tier === 2);
    expect(tier2).toBeDefined();
    if (!tier2) throw new Error('expected tier-2 emit');
    expect(tier2.title).toContain('90min+');
    expect(tier2.title).not.toContain('1.5h+');
  });
});

describe('BUG-577 cycle-2 absorb-2 (L4 CONCERN-1) — system_actor metadata persistence', () => {
  it('TP-PA-30: CRITICAL_RECIPIENT_REASSIGNED audit_log row carries system_actor field', async () => {
    // BUG-577 cycle-2 absorb-2 — actorId 'system:pathology-critical-
    // scheduler' is silently NULL'd by audit.ts UUID sanitiser.
    // The system_actor metadata field survives JSONB serialization
    // so AHPRA forensic queries can filter on
    // `new_data->>'system_actor'`.
    const r = row({ primary_clinician_id: 'inactive-A', ordered_by_id: 'inactive-B' });
    const ctx = buildCtx([r]);
    ctx.resolveActiveRecipients = vi.fn(async () => ({
      active: ['admin-X'],
      reassignedToAdmin: 'admin-X',
    }));
    await processPathologyCriticalAlerts(NOW, ctx);
    expect(ctx.auditCalls).toHaveLength(1);
    expect(ctx.auditCalls[0].metadata).toMatchObject({
      system_actor: 'pathology-critical-scheduler',
    });
  });

  it('TP-PA-31: CRITICAL_NO_RECIPIENT_AVAILABLE audit_log row carries system_actor field', async () => {
    const r = row({ primary_clinician_id: 'inactive-A', ordered_by_id: 'inactive-B' });
    const ctx = buildCtx([r]);
    ctx.resolveActiveRecipients = vi.fn(async () => ({
      active: [],
      reassignedToAdmin: null,
    }));
    await processPathologyCriticalAlerts(NOW, ctx);
    expect(ctx.auditCalls).toHaveLength(1);
    expect(ctx.auditCalls[0].metadata).toMatchObject({
      system_actor: 'pathology-critical-scheduler',
    });
  });
});

describe('BUG-585-FOLLOWUP-MULTI-TIER-CASCADE', () => {
  it('TP-PA-32: tier-3/tier-4 chain emits with distinct payload tiers and lower-tier dedupe', async () => {
    const r = row({
      created_at: new Date(NOW.getTime() - 9 * 3600_000), // 9h old -> all tiers due
      primary_clinician_id: 'sA',
      ordered_by_id: 'sB',
    });
    const ctx = buildCtx([r]);
    ctx.getEscalationThreshold = vi.fn(async () => 120);
    ctx.getEscalationThresholdByTier = vi.fn(async (_clinicId, tier) => {
      if (tier === 2) return 120;
      if (tier === 3) return 240;
      return 480;
    });
    ctx.listEscalationRecipientsByTier = vi.fn(async (_clinicId, _patientId, tier) => {
      if (tier === 2) return ['sA', 'team-lead-1'];
      if (tier === 3) return ['team-lead-1', 'governance-1'];
      return ['governance-1', 'regulatory-1'];
    });

    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(out.emitted).toBe(5); // tier-1(2) + tier-2(1) + tier-3(1) + tier-4(1)
    const tier2 = ctx.emitCalls.filter((c) => c.payload.tier === 2).map((c) => c.userId);
    const tier3 = ctx.emitCalls.filter((c) => c.payload.tier === 3).map((c) => c.userId);
    const tier4 = ctx.emitCalls.filter((c) => c.payload.tier === 4).map((c) => c.userId);
    expect(tier2).toEqual(['team-lead-1']);
    expect(tier3).toEqual(['governance-1']);
    expect(tier4).toEqual(['regulatory-1']);
  });

  it('TP-PA-33: row aged 3h triggers tier-2 only (tier-3/4 remain gated)', async () => {
    const r = row({ created_at: new Date(NOW.getTime() - 3 * 3600_000) });
    const ctx = buildCtx([r]);
    ctx.getEscalationThreshold = vi.fn(async () => 120);
    ctx.getEscalationThresholdByTier = vi.fn(async (_clinicId, tier) => {
      if (tier === 2) return 120;
      if (tier === 3) return 240;
      return 480;
    });
    ctx.listEscalationRecipientsByTier = vi.fn(async (_clinicId, _patientId, tier) => {
      if (tier === 2) return ['team-lead-1'];
      if (tier === 3) return ['governance-1'];
      return ['regulatory-1'];
    });

    const out = await processPathologyCriticalAlerts(NOW, ctx);
    expect(out.emitted).toBe(3); // tier-1(2) + tier-2(1)
    expect(ctx.emitCalls.filter((c) => c.payload.tier === 3)).toHaveLength(0);
    expect(ctx.emitCalls.filter((c) => c.payload.tier === 4)).toHaveLength(0);
  });
});
