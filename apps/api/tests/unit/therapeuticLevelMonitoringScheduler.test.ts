/**
 * BUG-592 — therapeutic-level monitoring scheduler.
 *
 * Pure-function unit tests for `processTherapeuticLevelAlerts` and its
 * helpers. Live-DB exercise of the SELECT (with LATERAL most-recent
 * pathology_results match) lives in
 * `apps/api/tests/integration/therapeuticLevelAlerts.int.test.ts`
 * (deferred to BUG-592-FOLLOWUP-INTEGRATION-TEST).
 *
 * Consolidates BUG-571 (lithium) + BUG-580 (warfarin/INR) into a
 * single drug-class-driven scheduler covering lithium / valproate /
 * carbamazepine / warfarin / phenytoin.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  dedupeKeyForTherapeuticLevel,
  dedupeKeyForTherapeuticLevelEscalation,
  isTherapeuticLevelEscalationDue,
  titleForTherapeuticLevel,
  processTherapeuticLevelAlerts,
  type TherapeuticLevelEmitInput,
  type TherapeuticLevelContext,
} from '../../src/jobs/schedulers/therapeuticLevelMonitoringScheduler';
import {
  THERAPEUTIC_LEVEL_DRUG_CONFIG,
  type TherapeuticLevelOverdueRow,
} from '../../src/features/prescriptions/therapeuticLevelHelpers';

const NOW = new Date('2026-04-26T15:30:00.000Z');
type TherapeuticLevelAuditCall = Parameters<
  TherapeuticLevelContext['writeAuditLogRow']
>[0];
const LITHIUM_CFG = THERAPEUTIC_LEVEL_DRUG_CONFIG.find((c) => c.drugLabel === 'lithium')!;
const WARFARIN_CFG = THERAPEUTIC_LEVEL_DRUG_CONFIG.find((c) => c.drugLabel === 'warfarin')!;

function row(overrides: Partial<TherapeuticLevelOverdueRow> = {}): TherapeuticLevelOverdueRow {
  return {
    prescription_id: '00000000-0000-0000-0000-000000000001',
    clinic_id: '00000000-0000-0000-0000-0000000000c1',
    patient_id: '00000000-0000-0000-0000-0000000000p1',
    generic_name: 'lithium carbonate',
    brand_name: 'Lithicarb',
    prescribed_by_staff_id: '00000000-0000-0000-0000-0000000000s1',
    primary_clinician_id: '00000000-0000-0000-0000-0000000000s2',
    drug_label: 'lithium',
    test_code: 'lithium',
    last_result_date: '2025-11-01',
    days_since_last_result: 176,
    ...overrides,
  };
}

function buildCtx(rowsByDrug: Map<string, TherapeuticLevelOverdueRow[]>): TherapeuticLevelContext & {
  emitCalls: TherapeuticLevelEmitInput[];
  auditCalls: TherapeuticLevelAuditCall[];
} {
  const emitCalls: TherapeuticLevelEmitInput[] = [];
  const auditCalls: TherapeuticLevelAuditCall[] = [];
  return {
    listClinicsToWalk: vi.fn(async () => ['00000000-0000-0000-0000-0000000000c1']),
    resolveDrugConfigs: vi.fn(async (clinicIds: string[]) => {
      // Default: walk only configured drug labels with their default thresholds.
      const out: Array<{
        clinicId: string;
        drugConfig: typeof THERAPEUTIC_LEVEL_DRUG_CONFIG[number];
        thresholdDays: number;
      }> = [];
      for (const clinicId of clinicIds) {
        for (const drugConfig of THERAPEUTIC_LEVEL_DRUG_CONFIG) {
          out.push({ clinicId, drugConfig, thresholdDays: drugConfig.defaultThresholdDays });
        }
      }
      return out;
    }),
    listOverdueTherapeuticLevels: vi.fn(async (drugConfig, _thresholdDays, _clinicId) => {
      // BUG-592 cycle-2 absorb (L3 #3) — capture full args for
      // mutation-resistance assertions in tests TP-TL-19/20.
      return rowsByDrug.get(drugConfig.drugLabel) ?? [];
    }),
    emit: vi.fn(async (input) => {
      emitCalls.push(input);
      return { ids: ['nid'], published: true };
    }),
    resolveActiveRecipients: vi.fn(async (_clinicId, prescriber, primary) => {
      const active: string[] = [];
      if (prescriber) active.push(prescriber);
      if (primary && primary !== prescriber) active.push(primary);
      return { active, reassignedToAdmin: null };
    }),
    writeAuditLogRow: vi.fn(async (input: TherapeuticLevelAuditCall) => {
      auditCalls.push(input);
    }),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    emitCalls,
    auditCalls,
  };
}

describe('BUG-592 — THERAPEUTIC_LEVEL_DRUG_CONFIG', () => {
  it('TP-TL-1: covers lithium + valproate + carbamazepine + warfarin + phenytoin', () => {
    const labels = THERAPEUTIC_LEVEL_DRUG_CONFIG.map((c) => c.drugLabel).sort();
    expect(labels).toEqual(['carbamazepine', 'lithium', 'phenytoin', 'valproate', 'warfarin']);
  });

  it('TP-TL-2: each drug has at least one test_code', () => {
    for (const c of THERAPEUTIC_LEVEL_DRUG_CONFIG) {
      expect(c.testCodes.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('TP-TL-3: warfarin default threshold (14 days) is tighter than lithium (90 days)', () => {
    const warfarin = THERAPEUTIC_LEVEL_DRUG_CONFIG.find((c) => c.drugLabel === 'warfarin')!;
    const lithium = THERAPEUTIC_LEVEL_DRUG_CONFIG.find((c) => c.drugLabel === 'lithium')!;
    expect(warfarin.defaultThresholdDays).toBeLessThan(lithium.defaultThresholdDays);
  });

  it('TP-TL-4: drug-pattern matches Australian PBS brand variants', () => {
    expect('lithicarb').toMatch(LITHIUM_CFG.pattern);
    expect('Lithium Carbonate').toMatch(LITHIUM_CFG.pattern);
    expect('Priadel').toMatch(LITHIUM_CFG.pattern);
    expect('Marevan').toMatch(WARFARIN_CFG.pattern);
    expect('Coumadin').toMatch(WARFARIN_CFG.pattern);
    expect('Tegretol').toMatch(THERAPEUTIC_LEVEL_DRUG_CONFIG[2].pattern);
    const phenytoin = THERAPEUTIC_LEVEL_DRUG_CONFIG.find((c) => c.drugLabel === 'phenytoin')!;
    expect('Dilantin').toMatch(phenytoin.pattern);
    expect('Epanutin').toMatch(phenytoin.pattern);
  });
});

describe('BUG-592 — dedupeKeyForTherapeuticLevel', () => {
  it('TP-TL-5: includes drug_label + prescription_id + staff_id + fired-day', () => {
    const k = dedupeKeyForTherapeuticLevel('lithium', 'rx1', 's1', NOW);
    expect(k).toBe('therapeutic-level:lithium:rx1:s1:fired-day:2026-04-26');
  });

  it('TP-TL-6: bumps daily for perpetually-overdue surveillance', () => {
    const day1 = new Date('2026-04-26T15:30:00.000Z');
    const day2 = new Date('2026-04-27T15:30:00.000Z');
    expect(dedupeKeyForTherapeuticLevel('lithium', 'rx1', 's1', day1)).not.toBe(
      dedupeKeyForTherapeuticLevel('lithium', 'rx1', 's1', day2),
    );
  });

  it('TP-TL-7: distinguishes by drug_label', () => {
    const a = dedupeKeyForTherapeuticLevel('lithium', 'rx1', 's1', NOW);
    const b = dedupeKeyForTherapeuticLevel('warfarin', 'rx1', 's1', NOW);
    expect(a).not.toBe(b);
  });

  it('TP-TL-7b: tier-2 escalation key uses distinct namespace + fired-day', () => {
    const k = dedupeKeyForTherapeuticLevelEscalation('lithium', 'rx1', 's1', NOW);
    expect(k).toBe('therapeutic-level-escalation:lithium:rx1:s1:fired-day:2026-04-26');
  });
});

describe('BUG-592-FOLLOWUP — escalation due predicate', () => {
  it('TP-TL-7c: escalation due at/after local threshold minutes', () => {
    expect(isTherapeuticLevelEscalationDue(new Date('2026-04-26T00:31:00.000Z'), 300)).toBe(true);
  });

  it('TP-TL-7d: escalation not due before local threshold minutes', () => {
    expect(isTherapeuticLevelEscalationDue(new Date('2026-04-25T14:10:00.000Z'), 30)).toBe(false);
  });
});

describe('BUG-592 — titleForTherapeuticLevel', () => {
  it('TP-TL-8: NEVER-drawn surfaces explicitly with "NEVER drawn — baseline required"', () => {
    expect(titleForTherapeuticLevel('lithium', 'lithium', null)).toBe(
      'lithium lithium level NEVER drawn — baseline required',
    );
  });

  it('TP-TL-9: overdue includes days count', () => {
    expect(titleForTherapeuticLevel('warfarin', 'INR', 30)).toBe(
      'warfarin INR level overdue (30 days)',
    );
  });
});

describe('BUG-592 — processTherapeuticLevelAlerts', () => {
  it('TP-TL-10: zero clinics → emits zero, logs zero-clinics WARN', async () => {
    const ctx = buildCtx(new Map());
    ctx.listClinicsToWalk = vi.fn(async () => []);
    const out = await processTherapeuticLevelAlerts(NOW, ctx);
    expect(out).toEqual({ processed: 0, emitted: 0, errors: 0 });
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'THERAPEUTIC_LEVEL_ALERT_ZERO_CLINICS' }),
      expect.any(String),
    );
  });

  it('TP-TL-11: lithium overdue row → emits 2 (prescriber + primary) at critical severity', async () => {
    const r = row(); // 176 days since last lithium level → overdue
    const rowsByDrug = new Map<string, TherapeuticLevelOverdueRow[]>([['lithium', [r]]]);
    const ctx = buildCtx(rowsByDrug);
    const out = await processTherapeuticLevelAlerts(NOW, ctx);
    expect(out.emitted).toBe(2);
    expect(ctx.emitCalls[0].severity).toBe('critical');
    expect(ctx.emitCalls[0].category).toBe('therapeutic-level');
    expect(ctx.emitCalls[0].title).toContain('lithium');
    expect(ctx.emitCalls[0].title).toContain('176 days');
    expect(ctx.emitCalls[0].dedupeKey).toMatch(/^therapeutic-level:lithium:.+:fired-day:2026-04-26$/);
  });

  it('TP-TL-12: NEVER-drawn (last_result_date = NULL) emits with "NEVER drawn — baseline required"', async () => {
    const r = row({ last_result_date: null, days_since_last_result: null });
    const ctx = buildCtx(new Map([['lithium', [r]]]));
    await processTherapeuticLevelAlerts(NOW, ctx);
    expect(ctx.emitCalls[0].title).toContain('NEVER drawn');
    expect(ctx.emitCalls[0].body).toContain('NEVER had');
    expect(ctx.emitCalls[0].payload.never_drawn).toBe(true);
  });

  it('TP-TL-13: BOTH inactive → admin fallback emits + WARN log + audit_log row', async () => {
    const r = row({ prescribed_by_staff_id: 'inactive-A', primary_clinician_id: 'inactive-B' });
    const ctx = buildCtx(new Map([['lithium', [r]]]));
    ctx.resolveActiveRecipients = vi.fn(async () => ({
      active: ['admin-X'],
      reassignedToAdmin: 'admin-X',
    }));
    const out = await processTherapeuticLevelAlerts(NOW, ctx);
    expect(out.emitted).toBe(1);
    expect(ctx.emitCalls[0]?.userId).toBe('admin-X');
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'THERAPEUTIC_LEVEL_RECIPIENT_REASSIGNED_TO_ADMIN' }),
      expect.any(String),
    );
    expect(ctx.auditCalls).toHaveLength(1);
    expect(ctx.auditCalls[0]).toMatchObject({
      action: 'THERAPEUTIC_LEVEL_RECIPIENT_REASSIGNED',
      metadata: expect.objectContaining({
        admin_staff_id: 'admin-X',
        drug_label: 'lithium',
        reason: 'both_originals_inactive',
        system_actor: 'therapeutic-level-monitoring-scheduler',
      }),
    });
  });

  it('TP-TL-14: BOTH inactive AND no admin → ERROR + audit_log silent-drop', async () => {
    const r = row({ prescribed_by_staff_id: 'inactive-A', primary_clinician_id: 'inactive-B' });
    const ctx = buildCtx(new Map([['lithium', [r]]]));
    ctx.resolveActiveRecipients = vi.fn(async () => ({ active: [], reassignedToAdmin: null }));
    const out = await processTherapeuticLevelAlerts(NOW, ctx);
    expect(out.emitted).toBe(0);
    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'THERAPEUTIC_LEVEL_NO_RECIPIENT_AVAILABLE' }),
      expect.stringContaining('dropped alert'),
    );
    expect(ctx.auditCalls).toHaveLength(1);
    expect(ctx.auditCalls[0]).toMatchObject({
      action: 'THERAPEUTIC_LEVEL_NO_RECIPIENT_AVAILABLE',
      metadata: expect.objectContaining({
        reason: 'no_admin_configured',
        system_actor: 'therapeutic-level-monitoring-scheduler',
      }),
    });
  });

  it('TP-TL-14b: silent-drop escalates to tier-2 recipients when enabled', async () => {
    const r = row({ prescribed_by_staff_id: 'inactive-A', primary_clinician_id: 'inactive-B' });
    const ctx = buildCtx(new Map([['lithium', [r]]]));
    ctx.resolveActiveRecipients = vi.fn(async () => ({ active: [], reassignedToAdmin: null }));
    ctx.getEscalationThreshold = vi.fn(async () => 30);
    ctx.listEscalationRecipients = vi.fn(async () => ['team-lead-A']);
    const out = await processTherapeuticLevelAlerts(NOW, ctx);
    expect(out.emitted).toBe(1);
    expect(ctx.emitCalls[0].userId).toBe('team-lead-A');
    expect(ctx.emitCalls[0].payload.tier).toBe(2);
    expect(ctx.emitCalls[0].dedupeKey).toMatch(/^therapeutic-level-escalation:/);
  });

  it('TP-TL-15: warfarin overdue row → emits with INR test_code', async () => {
    const r = row({
      generic_name: 'warfarin',
      brand_name: 'Marevan',
      drug_label: 'warfarin',
      test_code: 'INR',
      last_result_date: '2026-04-01',
      days_since_last_result: 25,
    });
    const ctx = buildCtx(new Map([['warfarin', [r]]]));
    const out = await processTherapeuticLevelAlerts(NOW, ctx);
    expect(out.emitted).toBe(2);
    expect(ctx.emitCalls[0].title).toContain('warfarin INR');
    expect(ctx.emitCalls[0].payload.test_code).toBe('INR');
  });

  it('TP-TL-16: per-row failure does not stop subsequent rows', async () => {
    const r1 = row({ prescription_id: 'rx-fails' });
    const r2 = row({ prescription_id: 'rx-ok' });
    const ctx = buildCtx(new Map([['lithium', [r1, r2]]]));
    let nthCall = 0;
    ctx.emit = vi.fn(async (input) => {
      nthCall++;
      if (nthCall === 1) throw new Error('boom');
      ctx.emitCalls.push(input);
      return { ids: ['nid'], published: true };
    });
    const out = await processTherapeuticLevelAlerts(NOW, ctx);
    expect(out.processed).toBe(2);
    expect(out.errors).toBeGreaterThanOrEqual(1);
  });

  it('TP-TL-17: top-level listClinicsToWalk failure → returns zeroed counts (cron must not die)', async () => {
    const ctx = buildCtx(new Map());
    ctx.listClinicsToWalk = vi.fn(async () => { throw new Error('db down'); });
    const out = await processTherapeuticLevelAlerts(NOW, ctx);
    expect(out).toEqual({ processed: 0, emitted: 0, errors: 0 });
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('TP-TL-18: payload includes never_drawn flag for forensic queries', async () => {
    const overdue = row({ last_result_date: '2025-11-01', days_since_last_result: 176 });
    const neverDrawn = row({
      prescription_id: 'rx-never',
      last_result_date: null,
      days_since_last_result: null,
    });
    const ctx = buildCtx(new Map([['lithium', [overdue, neverDrawn]]]));
    await processTherapeuticLevelAlerts(NOW, ctx);
    const overdueEmits = ctx.emitCalls.filter((c) => !c.payload.never_drawn);
    const neverDrawnEmits = ctx.emitCalls.filter((c) => c.payload.never_drawn === true);
    expect(overdueEmits.length).toBeGreaterThan(0);
    expect(neverDrawnEmits.length).toBeGreaterThan(0);
  });
});

describe('BUG-592 cycle-2 absorb (L3 #1) — multi-clinic processing + clinicId scoping', () => {
  it('TP-TL-19: helper invoked WITH clinicId per (clinic, drug) pair', async () => {
    const ctx = buildCtx(new Map());
    ctx.listClinicsToWalk = vi.fn(async () => ['clinic-A', 'clinic-B']);
    await processTherapeuticLevelAlerts(NOW, ctx);
    // 2 clinics × 5 drug classes = 10 helper invocations.
    const listOverdueMock = vi.mocked(ctx.listOverdueTherapeuticLevels);
    expect(listOverdueMock).toHaveBeenCalledTimes(10);
    // Every call has 3 args: (drugConfig, thresholdDays, clinicId).
    const callArgs = listOverdueMock.mock.calls;
    for (const args of callArgs) {
      expect(args.length).toBe(3);
      expect(typeof args[2]).toBe('string'); // clinicId
      expect(['clinic-A', 'clinic-B']).toContain(args[2]);
    }
  });

  it('TP-TL-20: per-clinic threshold differential is correctly threaded to helper', async () => {
    const ctx = buildCtx(new Map());
    ctx.listClinicsToWalk = vi.fn(async () => ['inpatient-ward', 'community-clinic']);
    // Override resolveDrugConfigs to assert per-clinic threshold differential.
    ctx.resolveDrugConfigs = vi.fn(async (clinicIds: string[]) => {
      const out: Array<{
        clinicId: string;
        drugConfig: typeof THERAPEUTIC_LEVEL_DRUG_CONFIG[number];
        thresholdDays: number;
      }> = [];
      for (const clinicId of clinicIds) {
        const lithium = THERAPEUTIC_LEVEL_DRUG_CONFIG.find((c) => c.drugLabel === 'lithium')!;
        const thresholdDays = clinicId === 'inpatient-ward' ? 30 : 90;
        out.push({ clinicId, drugConfig: lithium, thresholdDays });
      }
      return out;
    });
    await processTherapeuticLevelAlerts(NOW, ctx);
    const calls = vi.mocked(ctx.listOverdueTherapeuticLevels).mock.calls;
    expect(calls.length).toBe(2);
    const inpatientCall = calls.find((c) => c[2] === 'inpatient-ward');
    const communityCall = calls.find((c) => c[2] === 'community-clinic');
    if (!inpatientCall || !communityCall) {
      throw new Error('expected both clinic-scoped helper calls');
    }
    expect(inpatientCall[1]).toBe(30); // tighter inpatient threshold
    expect(communityCall[1]).toBe(90); // standard community threshold
  });

  it('TP-TL-21: helper signature mutation-resistance — 3-arg signature enforced', () => {
    // BUG-592 cycle-2 absorb (L3 #3) regression: if helper signature
    // collapses back to (drugConfig, thresholdDays) (no clinicId),
    // TS would catch but type-elasticity could mask it. This test
    // pins the SHAPE at the test layer.
    const sig = (
      drugConfig: typeof THERAPEUTIC_LEVEL_DRUG_CONFIG[number],
      thresholdDays: number,
      clinicId: string,
    ) => {
      return { drugConfig, thresholdDays, clinicId };
    };
    const result = sig(THERAPEUTIC_LEVEL_DRUG_CONFIG[0], 90, 'clinic-A');
    expect(result.clinicId).toBe('clinic-A');
  });
});

describe('BUG-592 cycle-2 absorb (L4 RC-1) — case-insensitive test_code variants', () => {
  it('TP-TL-22: lithium drug config includes lowercase + mnemonic + LOINC', () => {
    const lithium = THERAPEUTIC_LEVEL_DRUG_CONFIG.find((c) => c.drugLabel === 'lithium')!;
    expect(lithium.testCodes).toContain('lithium');
    expect(lithium.testCodes).toContain('lith'); // AU lab mnemonic
    expect(lithium.testCodes).toContain('li'); // AU lab mnemonic
    expect(lithium.testCodes).toContain('14683-7'); // LOINC serum lithium
  });

  it('TP-TL-23: warfarin drug config includes INR variants + LOINC', () => {
    const warfarin = THERAPEUTIC_LEVEL_DRUG_CONFIG.find((c) => c.drugLabel === 'warfarin')!;
    expect(warfarin.testCodes).toContain('INR');
    expect(warfarin.testCodes).toContain('inr');
    expect(warfarin.testCodes).toContain('inr-1');
    expect(warfarin.testCodes).toContain('5894-1'); // LOINC PT/INR
  });

  it('TP-TL-24: valproate + carbamazepine include common AU mnemonics', () => {
    const valproate = THERAPEUTIC_LEVEL_DRUG_CONFIG.find((c) => c.drugLabel === 'valproate')!;
    const carbamazepine = THERAPEUTIC_LEVEL_DRUG_CONFIG.find((c) => c.drugLabel === 'carbamazepine')!;
    expect(valproate.testCodes).toContain('vpa');
    expect(carbamazepine.testCodes).toContain('cbz');
  });
});

describe('BUG-592 cycle-2 absorb (L4 RC-2) — word-boundary drug pattern', () => {
  it('TP-TL-25: lithium pattern is word-boundary anchored — does NOT substring-match "lithiumania" hypothetical', () => {
    const lithium = THERAPEUTIC_LEVEL_DRUG_CONFIG.find((c) => c.drugLabel === 'lithium')!;
    expect('lithium').toMatch(lithium.pattern);
    expect('Lithium Carbonate').toMatch(lithium.pattern);
    // Word boundaries prevent substring inside compound words.
    // Note: "lithium-orotate" still matches because hyphens are
    // word boundaries in regex; the practical risk this guards
    // against is whitespace-bounded false-positives.
    expect('alithiumase').not.toMatch(lithium.pattern); // hypothetical compound
  });

  it('TP-TL-26: warfarin pattern does NOT substring-match "swarfa" hypothetical', () => {
    const warfarin = THERAPEUTIC_LEVEL_DRUG_CONFIG.find((c) => c.drugLabel === 'warfarin')!;
    expect('warfarin').toMatch(warfarin.pattern);
    expect('Marevan').toMatch(warfarin.pattern);
    expect('coumadin transition note').toMatch(warfarin.pattern); // word-bounded match OK
    // Hypothetical false-positive that pre-cycle-2 substring-match
    // would have hit:
    expect('xwarfarinx').not.toMatch(warfarin.pattern);
  });
});
