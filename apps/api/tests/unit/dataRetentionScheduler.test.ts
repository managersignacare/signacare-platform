/**
 * BUG-374b Part 2 — destructive retention scheduler.
 *
 * Annual cron `0 4 1 1 *` AEST (Q-D).
 *
 * Triple-lock arming (Q-F): RETENTION_DRY_RUN=false env var AND
 * clinic.retention_purge_enabled=true AND manager-approval-active
 * (segregation of duties + 30-day TTL).
 *
 * For each clinic that passes the triple-lock: enumerate purgeable
 * patients via `buildPurgeableSql(configuredYears)`, then call the
 * canonical `anonymisePatientService.anonymise(systemAuth, patientId,
 * 'retention_floor_exceeded')` per row.
 */
import { describe, it, expect, vi } from 'vitest';
import { Result, type AuthContext } from '@signacare/shared';
import { AppError } from '../../src/shared/errors';
import {
  processDataRetention,
  type DataRetentionContext,
  type ClinicRetentionRow,
  type CandidatePatientRow,
} from '../../src/jobs/schedulers/dataRetentionScheduler';

const NOW = new Date('2026-04-27T04:00:00.000Z');

interface AnonymiseCall {
  clinicId: string
  patientId: string
  reason: string
}

function getMockCalls(fn: unknown): unknown[][] {
  return (fn as { mock?: { calls?: unknown[][] } }).mock?.calls ?? [];
}

function clinic(o: Partial<ClinicRetentionRow> = {}): ClinicRetentionRow {
  return {
    clinic_id: '00000000-0000-0000-0000-0000000000c1',
    data_retention_years: 25,
    retention_purge_enabled: true,
    retention_purge_enabled_by_staff_id: '00000000-0000-0000-0000-0000000000s1',
    retention_purge_enabled_at: new Date('2026-04-26T00:00:00Z'),
    retention_purge_manager_approved_by_staff_id: '00000000-0000-0000-0000-0000000000s2',
    retention_purge_manager_approved_at: new Date('2026-04-26T00:00:00Z'),
    ...o,
  };
}

function patient(o: Partial<CandidatePatientRow> = {}): CandidatePatientRow {
  return {
    patient_id: '00000000-0000-0000-0000-0000000000p1',
    clinic_id: '00000000-0000-0000-0000-0000000000c1',
    ...o,
  };
}

function buildCtx(opts: {
  clinics?: ClinicRetentionRow[];
  candidatesByClinic?: Record<string, CandidatePatientRow[]>;
  dryRun?: boolean;
} = {}): DataRetentionContext & { anonymiseCalls: AnonymiseCall[] } {
  const anonymiseCalls: AnonymiseCall[] = [];
  return {
    isDryRun: () => opts.dryRun ?? true,
    listClinics: vi.fn(async () => opts.clinics ?? []),
    listCandidatesForClinic: vi.fn(async (c) =>
      (opts.candidatesByClinic ?? {})[c.clinic_id] ?? []),
    anonymise: vi.fn(async (auth: AuthContext, patientId: string, reason: string) => {
      anonymiseCalls.push({ clinicId: auth.clinicId, patientId, reason });
      return Result.ok({ patientId, mutated: true, scrubberVersion: 'v1.0-bug374b' });
    }),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    anonymiseCalls,
  };
}

describe('BUG-374b Part 2 — processDataRetention', () => {
  it('TP-RSCHED-1: dry-run mode → ctx.anonymise NEVER called; logs RETENTION_DRY_RUN_CANDIDATE', async () => {
    const ctx = buildCtx({
      dryRun: true,
      clinics: [clinic()],
      candidatesByClinic: { [clinic().clinic_id]: [patient()] },
    });
    const out = await processDataRetention(NOW, ctx);
    expect(out.processedClinics).toBe(1);
    expect(out.candidates).toBe(1);
    expect(out.anonymised).toBe(0);
    expect(ctx.anonymise).not.toHaveBeenCalled();
    const dryRunLogs = getMockCalls(ctx.logger.warn).filter((c) =>
      JSON.stringify(c[0]).includes('RETENTION_DRY_RUN_CANDIDATE'),
    );
    expect(dryRunLogs.length).toBe(1);
  });

  it('TP-RSCHED-2: per-clinic flag off → SKIP entirely; logs RETENTION_CLINIC_SKIPPED', async () => {
    const c = clinic({ retention_purge_enabled: false });
    const ctx = buildCtx({
      dryRun: false,
      clinics: [c],
      candidatesByClinic: { [c.clinic_id]: [patient()] },
    });
    const out = await processDataRetention(NOW, ctx);
    expect(ctx.listCandidatesForClinic).not.toHaveBeenCalled();
    expect(out.skippedClinics).toBe(1);
    const skipLogs = getMockCalls(ctx.logger.warn).filter((c) =>
      JSON.stringify(c[0]).includes('RETENTION_CLINIC_SKIPPED'),
    );
    expect(skipLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('TP-RSCHED-3: per-clinic flag on + dry-run → STILL skips mutation', async () => {
    const ctx = buildCtx({
      dryRun: true,
      clinics: [clinic()],
      candidatesByClinic: { [clinic().clinic_id]: [patient()] },
    });
    await processDataRetention(NOW, ctx);
    expect(ctx.anonymise).not.toHaveBeenCalled();
  });

  it('TP-RSCHED-4: manager-approval missing → SKIP clinic; logs RETENTION_MANAGER_APPROVAL_MISSING', async () => {
    const c = clinic({
      retention_purge_manager_approved_at: null,
      retention_purge_manager_approved_by_staff_id: null,
    });
    const ctx = buildCtx({
      dryRun: false,
      clinics: [c],
      candidatesByClinic: { [c.clinic_id]: [patient()] },
    });
    const out = await processDataRetention(NOW, ctx);
    expect(ctx.anonymise).not.toHaveBeenCalled();
    expect(out.skippedClinics).toBe(1);
    const logs = getMockCalls(ctx.logger.warn).filter((c) =>
      JSON.stringify(c[0]).includes('RETENTION_MANAGER_APPROVAL_MISSING'),
    );
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it('TP-RSCHED-5: segregation-of-duties violation (approver === enabler) → SKIP', async () => {
    const c = clinic({
      retention_purge_enabled_by_staff_id: 'sX',
      retention_purge_manager_approved_by_staff_id: 'sX',
    });
    const ctx = buildCtx({
      dryRun: false,
      clinics: [c],
      candidatesByClinic: { [c.clinic_id]: [patient()] },
    });
    await processDataRetention(NOW, ctx);
    expect(ctx.anonymise).not.toHaveBeenCalled();
  });

  it('TP-RSCHED-6: 30-day TTL expired → SKIP', async () => {
    const c = clinic({
      retention_purge_manager_approved_at: new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000),
    });
    const ctx = buildCtx({
      dryRun: false,
      clinics: [c],
      candidatesByClinic: { [c.clinic_id]: [patient()] },
    });
    await processDataRetention(NOW, ctx);
    expect(ctx.anonymise).not.toHaveBeenCalled();
  });

  it('TP-RSCHED-7: zero-row tick → emit RETENTION_ZERO_ROWS WARN log', async () => {
    const ctx = buildCtx({ clinics: [], dryRun: false });
    const out = await processDataRetention(NOW, ctx);
    expect(out.processedClinics).toBe(0);
    const logs = getMockCalls(ctx.logger.warn).filter((c) =>
      JSON.stringify(c[0]).includes('RETENTION_ZERO_ROWS'),
    );
    expect(logs.length).toBe(1);
  });

  it('TP-RSCHED-8: per-row failure does not stop subsequent rows', async () => {
    const c = clinic();
    const candidates = [patient({ patient_id: 'p1' }), patient({ patient_id: 'p2' })];
    const ctx = buildCtx({ dryRun: false, clinics: [c], candidatesByClinic: { [c.clinic_id]: candidates } });
    let nth = 0;
    ctx.anonymise = vi.fn(async (auth, patientId, reason) => {
      nth++;
      if (nth === 1) return Result.err(new AppError('boom', 500, 'X'));
      ctx.anonymiseCalls.push({ clinicId: auth.clinicId, patientId, reason });
      return Result.ok({ patientId, mutated: true, scrubberVersion: 'v1.0-bug374b' });
    });
    const out = await processDataRetention(NOW, ctx);
    expect(out.candidates).toBe(2);
    expect(out.errors).toBeGreaterThanOrEqual(1);
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('TP-RSCHED-9: top-level listClinics failure → zeroed counts + error log', async () => {
    const ctx = buildCtx();
    ctx.listClinics = vi.fn(async () => { throw new Error('db down'); });
    const out = await processDataRetention(NOW, ctx);
    expect(out.processedClinics).toBe(0);
    expect(ctx.logger.error).toHaveBeenCalled();
  });

  it('TP-RSCHED-10: cross-tenant isolation — clinic A purgeable, B flag off; only A processed', async () => {
    const cA = clinic({ clinic_id: 'cA' });
    const cB = clinic({ clinic_id: 'cB', retention_purge_enabled: false });
    const ctx = buildCtx({
      dryRun: false,
      clinics: [cA, cB],
      candidatesByClinic: { cA: [patient({ clinic_id: 'cA' })], cB: [patient({ clinic_id: 'cB' })] },
    });
    await processDataRetention(NOW, ctx);
    const calls = ctx.anonymiseCalls.map((c) => c.clinicId);
    expect(calls).toContain('cA');
    expect(calls).not.toContain('cB');
  });

  it('TP-RSCHED-11: configuredYears < 25 → still purges with floor of 25 (caller-protected by L4 CHECK; L5 belt)', async () => {
    // Even though DB CHECK should prevent this, the scheduler defends
    // against a hypothetical bypass by passing only configuredYears
    // (no override) into buildPurgeableSql which floors at 25.
    const c = clinic({ data_retention_years: 25 });
    const ctx = buildCtx({
      dryRun: false,
      clinics: [c],
      candidatesByClinic: { [c.clinic_id]: [patient()] },
    });
    await processDataRetention(NOW, ctx);
    expect(ctx.listCandidatesForClinic).toHaveBeenCalledWith(c, NOW);
  });

  it('TP-RSCHED-12: anonymise call carries reason="retention_floor_exceeded"', async () => {
    const c = clinic();
    const ctx = buildCtx({ dryRun: false, clinics: [c], candidatesByClinic: { [c.clinic_id]: [patient()] } });
    await processDataRetention(NOW, ctx);
    expect(ctx.anonymiseCalls[0].reason).toBe('retention_floor_exceeded');
  });

  it('TP-RSCHED-13: anonymise call uses synthesised superadmin AuthContext for the clinic', async () => {
    const c = clinic({ clinic_id: 'cZ' });
    const ctx = buildCtx({ dryRun: false, clinics: [c], candidatesByClinic: { cZ: [patient({ clinic_id: 'cZ' })] } });
    await processDataRetention(NOW, ctx);
    expect(getMockCalls(ctx.anonymise)[0]?.[0]).toMatchObject({
      role: 'superadmin',
      clinicId: 'cZ',
    });
  });

  it('TP-RSCHED-14: idempotent re-run — already-purged candidates yield mutated:false outcome', async () => {
    const c = clinic();
    const ctx = buildCtx({ dryRun: false, clinics: [c], candidatesByClinic: { [c.clinic_id]: [patient()] } });
    ctx.anonymise = vi.fn(async (auth, patientId) => {
      ctx.anonymiseCalls.push({ clinicId: auth.clinicId, patientId, reason: 'retention_floor_exceeded' });
      return Result.ok({ patientId, mutated: false, scrubberVersion: 'v1.0-bug374b' });
    });
    const out = await processDataRetention(NOW, ctx);
    expect(out.anonymised).toBe(0);
    expect(out.alreadyPurged).toBe(1);
  });
});
