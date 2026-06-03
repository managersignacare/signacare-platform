// apps/api/src/jobs/schedulers/dataRetentionScheduler.ts
//
// BUG-374b Part 2 — annual destructive retention purge.
//
// Cron: `0 4 1 1 *` Australia/Melbourne (1st January 04:00 AEST) per Q-D.
//
// TRIPLE-LOCK arming (Q-F): all three gates required for production purge:
//   1. RETENTION_DRY_RUN env var === 'false' (default 'true')
//   2. clinic.retention_purge_enabled === true (BUG-374a; superadmin)
//   3. retentionApprovalService.isApprovalActive(state, now)
//      - clinic.retention_purge_manager_approved_at is set
//      - approver != enabler (segregation of duties)
//      - approval is within last 30 days (TTL)
//
// On per-clinic gate fail → log structured WARN (kind:
// 'RETENTION_CLINIC_SKIPPED' / 'RETENTION_MANAGER_APPROVAL_MISSING')
// and skip that clinic. On dry-run gate → log
// 'RETENTION_DRY_RUN_CANDIDATE' per row but do NOT call anonymise.
//
// SCHEDULER ONLY — uses `dbAdmin` per BUG-583 (no RLS context).
//
// fix-registry anchors: BUG-374B-SCHED-EXISTS, BUG-374B-DRY-RUN-DEFAULT,
// BUG-374B-PER-CLINIC-FLAG-CHECK, BUG-374B-MANAGER-APPROVAL-CHECK,
// BUG-374B-DBADMIN-FROM-INCEPTION, BUG-374B-ZERO-ROW-WARN.

import cron from 'node-cron';
import type { AuthContext } from '@signacare/shared';
import { Result, isErr } from '@signacare/shared';
import { dbAdmin } from '../../db/db';
import { logger as defaultLogger } from '../../utils/logger';
import { registerShutdownHook } from '../../shared/gracefulShutdown';
import {
  anonymisePatientService,
  type AnonymiseOutcome,
} from '../../features/privacy/anonymisePatientService';
import {
  isApprovalActive,
  type RetentionApprovalState,
} from '../../features/power-settings/retentionApprovalService';
import { buildPurgeableSql } from '../../features/privacy/retentionPredicate';
import { AppError } from '../../shared/errors';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * @schema-drift-exempt select-aliased
 * SELECT-result shape from `clinics` with `id as clinic_id` aliasing in
 * `liveContext().listClinics`. Not a 1:1 row mapping — only the columns the
 * scheduler consumes are projected. The bidirectional row-iface guard
 * (CLAUDE.md §15, BUG-529) binds this to the `clinics` table via the
 * `dbAdmin('clinics')` call upstream; the alias makes a forward "no clinic_id
 * column" false positive and the reverse "many columns omitted" expected.
 */
export interface ClinicRetentionRow {
  clinic_id: string;
  data_retention_years: number;
  retention_purge_enabled: boolean;
  retention_purge_enabled_by_staff_id: string | null;
  retention_purge_enabled_at: Date | null;
  retention_purge_manager_approved_by_staff_id: string | null;
  retention_purge_manager_approved_at: Date | null;
}

/**
 * @schema-drift-exempt select-aliased
 * SELECT-result shape from `patients as p` with `p.id as patient_id`
 * aliasing in `liveContext().listCandidatesForClinic`. Only the two columns
 * the scheduler needs are projected; bidirectional row-iface guard would
 * otherwise flag `patient_id` as missing and the rest of `patients` as
 * undeclared. The guard's table-binding heuristic incorrectly resolves to
 * `clinics` because the immediately preceding `dbAdmin` call in the file
 * targets `clinics`; the exemption short-circuits both directions.
 */
export interface CandidatePatientRow {
  patient_id: string;
  clinic_id: string;
}

export interface DataRetentionContext {
  isDryRun(): boolean;
  listClinics(now: Date): Promise<ClinicRetentionRow[]>;
  listCandidatesForClinic(
    clinic: ClinicRetentionRow,
    now: Date,
  ): Promise<CandidatePatientRow[]>;
  anonymise(
    auth: AuthContext,
    patientId: string,
    reason: string,
  ): Promise<Result<AnonymiseOutcome, AppError>>;
  logger: {
    info(obj: object | string, msg?: string, ...extras: unknown[]): void;
    warn(obj: object | string, msg?: string, ...extras: unknown[]): void;
    error(obj: object | string, msg?: string, ...extras: unknown[]): void;
  };
}

export interface DataRetentionOutcome {
  processedClinics: number;
  skippedClinics: number;
  candidates: number;
  anonymised: number;
  alreadyPurged: number;
  errors: number;
}

// ── Synthesised system AuthContext for scheduler-driven anonymise calls ───

function systemAuthForClinic(clinicId: string): AuthContext {
  // The scheduler runs outside any HTTP request; the anonymisePatientService
  // requires AuthContext per CLAUDE.md §13. We synthesise a superadmin-role
  // context whose actorStaffId is a sentinel `'system'`.
  //
  // L5 absorb-1 — clarifying the audit-attribution mechanism (the previous
  // version of this comment claimed the literal `'system'` reaches
  // audit_log.staff_id; that is NOT true). `apps/api/src/utils/audit.ts:245`
  // runs `userId` through a UUID regex; non-UUID strings are coerced to
  // NULL. Therefore audit_log.staff_id and audit_log.user_id are BOTH NULL
  // for scheduler-driven anonymisations.
  //
  // Forensic identification is via `audit_log.new_data->>'reason' =
  // 'retention_floor_exceeded'` — anonymisePatientService stamps this
  // reason on every accepted call (BUG-374b Part 1), so a SQL query can
  // distinguish scheduler-driven from admin-UI anonymisations even though
  // staff_id is NULL.
  //
  // A future provisioning improvement (L5 follow-up BUG-374b-CASCADE-8)
  // can seed a `'system'` row in `staff` with a known UUID and reference
  // it from this helper; that would make scheduler attribution queryable
  // by staff_id like every other actor and remove the new_data->>'reason'
  // dependency.
  return {
    staffId: 'system',
    clinicId,
    role: 'superadmin',
    permissions: [],
  };
}

function clinicApprovalState(c: ClinicRetentionRow): RetentionApprovalState {
  return {
    retentionPurgeEnabled: c.retention_purge_enabled,
    retentionPurgeEnabledByStaffId: c.retention_purge_enabled_by_staff_id,
    retentionPurgeEnabledAt: c.retention_purge_enabled_at,
    retentionPurgeManagerApprovedByStaffId: c.retention_purge_manager_approved_by_staff_id,
    retentionPurgeManagerApprovedAt: c.retention_purge_manager_approved_at,
  };
}

// ── Top-level processor (testable; cron tick wraps this) ──────────────────

export async function processDataRetention(
  now: Date,
  ctx: DataRetentionContext,
): Promise<DataRetentionOutcome> {
  const out: DataRetentionOutcome = {
    processedClinics: 0,
    skippedClinics: 0,
    candidates: 0,
    anonymised: 0,
    alreadyPurged: 0,
    errors: 0,
  };

  let clinics: ClinicRetentionRow[] = [];
  try {
    clinics = await ctx.listClinics(now);
  } catch (err) {
    ctx.logger.error({ err, kind: 'RETENTION_TOP_LEVEL_ERROR' }, 'data-retention scheduler top-level failure');
    return out;
  }

  if (clinics.length === 0) {
    ctx.logger.warn(
      { kind: 'RETENTION_ZERO_ROWS', tickAt: now.toISOString() },
      'data-retention scheduler — zero clinics to process (either no active clinics or access-path failure)',
    );
    return out;
  }

  const dryRun = ctx.isDryRun();

  for (const c of clinics) {
    out.processedClinics++;

    // Gate #2: per-clinic flag.
    if (!c.retention_purge_enabled) {
      out.skippedClinics++;
      ctx.logger.warn(
        {
          kind: 'RETENTION_CLINIC_SKIPPED',
          clinicId: c.clinic_id,
          reason: 'retention_purge_enabled=false',
        },
        'data-retention scheduler — clinic skipped (per-clinic flag off)',
      );
      continue;
    }

    // Gate #3: manager approval (segregation of duties + 30-day TTL).
    if (!isApprovalActive(clinicApprovalState(c), now)) {
      out.skippedClinics++;
      ctx.logger.warn(
        {
          kind: 'RETENTION_MANAGER_APPROVAL_MISSING',
          clinicId: c.clinic_id,
          approvedAt: c.retention_purge_manager_approved_at,
          approvedBy: c.retention_purge_manager_approved_by_staff_id,
          enabledBy: c.retention_purge_enabled_by_staff_id,
        },
        'data-retention scheduler — clinic skipped (manager approval missing/expired/segregation-violation)',
      );
      continue;
    }

    // All gates pass; enumerate candidates.
    let candidates: CandidatePatientRow[] = [];
    try {
      candidates = await ctx.listCandidatesForClinic(c, now);
    } catch (err) {
      out.errors++;
      ctx.logger.error(
        { err, clinicId: c.clinic_id, kind: 'RETENTION_LIST_CANDIDATES_ERROR' },
        'data-retention scheduler — listCandidatesForClinic failed',
      );
      continue;
    }

    out.candidates += candidates.length;
    if (candidates.length > 0) {
      ctx.logger.warn(
        {
          kind: dryRun ? 'RETENTION_DRY_RUN_CANDIDATE' : 'RETENTION_REAL_PURGE_CANDIDATE',
          clinicId: c.clinic_id,
          candidateCount: candidates.length,
          configuredYears: c.data_retention_years,
        },
        dryRun
          ? 'data-retention scheduler — DRY RUN: candidate enumerated, no mutation'
          : 'data-retention scheduler — REAL: anonymisation will be applied',
      );
    }

    // Gate #1: dry-run env var. When dry-run, skip mutation entirely.
    if (dryRun) continue;

    const auth = systemAuthForClinic(c.clinic_id);
    for (const candidate of candidates) {
      try {
        const r = await ctx.anonymise(auth, candidate.patient_id, 'retention_floor_exceeded');
        if (isErr(r)) {
          out.errors++;
          ctx.logger.error(
            { clinicId: c.clinic_id, patientId: candidate.patient_id, error: r.error },
            'data-retention scheduler — anonymise returned err',
          );
          continue;
        }
        if (r.value.mutated) out.anonymised++;
        else out.alreadyPurged++;
      } catch (err) {
        out.errors++;
        ctx.logger.error(
          { err, clinicId: c.clinic_id, patientId: candidate.patient_id },
          'data-retention scheduler — anonymise threw',
        );
      }
    }
  }

  return out;
}

// ── Live context (production binding) ─────────────────────────────────────

function liveContext(): DataRetentionContext {
  return {
    isDryRun() {
      return (process.env.RETENTION_DRY_RUN ?? 'true') !== 'false';
    },
    async listClinics(_now: Date): Promise<ClinicRetentionRow[]> {
      const rows = await dbAdmin('clinics')
        .where({ is_active: true })
        .whereNull('deleted_at')
        .select(
          'id as clinic_id',
          'data_retention_years',
          'retention_purge_enabled',
          'retention_purge_enabled_by_staff_id',
          'retention_purge_enabled_at',
          'retention_purge_manager_approved_by_staff_id',
          'retention_purge_manager_approved_at',
        );
      return rows as unknown as ClinicRetentionRow[];
    },
    async listCandidatesForClinic(c, _now: Date): Promise<CandidatePatientRow[]> {
      const sql = buildPurgeableSql(c.data_retention_years);
      const rows = await dbAdmin('patients as p')
        .where('p.clinic_id', c.clinic_id)
        .whereNull('p.deleted_at')
        .whereNull('p.purged_at')
        .whereRaw(sql)
        .select('p.id as patient_id', 'p.clinic_id');
      return rows as unknown as CandidatePatientRow[];
    },
    async anonymise(auth, patientId, reason) {
      return anonymisePatientService.anonymise(auth, patientId, reason);
    },
    logger: defaultLogger,
  };
}

// ── Cron tick ─────────────────────────────────────────────────────────────

const dataRetentionTask = cron.schedule(
  process.env.RETENTION_CRON ?? '0 4 1 1 *',
  async () => {
    defaultLogger.info('Running data-retention scheduler');
    try {
      const out = await processDataRetention(new Date(), liveContext());
      defaultLogger.info(out, 'Data-retention scheduler tick complete');
    } catch (err) {
      defaultLogger.error({ err }, 'Data-retention scheduler failed');
    }
  },
  { timezone: process.env.RETENTION_TZ ?? 'Australia/Melbourne' },
);

if (process.env.NODE_ENV !== 'test') {
  registerShutdownHook({
    name: 'scheduler:data-retention',
    priority: 85,
    handler: async () => { dataRetentionTask.stop(); },
  });
}

export { dataRetentionTask };
