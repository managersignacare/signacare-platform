// apps/api/src/jobs/schedulers/clozapineMonitoringWeekScheduler.ts
//
// BUG-574 — clozapine monitoring-week review-point scheduler.
//
// Daily 07:20 AEST cron scans active `clozapine_registrations` for the
// first 18 monitoring weeks and emits reminders around each weekly
// review point (schema-truth axis: `next_blood_due_date`):
//   - T-3d / T-1d / T-0d (due today)
//   - T+overdue
//
// Why separate from BUG-569:
// BUG-569 only alerts once monitoring is already overdue. BUG-574 adds
// pre-due and due-today visibility for weekly review points in weeks
// 1..18 where continuity risk is highest.
//
// SCHEDULER ONLY — uses `dbAdmin` per BUG-583 (RLS-closed query/insert
// paths outside request context). Tenant scoping is preserved through
// FK-bound `clinic_id` carried into every emit.

import cron from 'node-cron';
import { dbAdmin } from '../../db/db';
import { logger as defaultLogger } from '../../utils/logger';
import { registerShutdownHook } from '../../shared/gracefulShutdown';
import { writeAuditLog } from '../../utils/audit';
import { emitSchedulerSignal } from './schedulerSignalEmitter';

export type ClozapineMonitoringWeekBucket = 'T-3d' | 'T-1d' | 'T-0d' | 'T+overdue';

/**
 * @schema-drift-exempt select-aliased
 * BUG-574 — scheduler row shape is select-aliased across
 * `clozapine_registrations` + current-team fallback JOINs.
 */
export interface ClozapineMonitoringWeekRow {
  registration_id: string;
  clinic_id: string;
  patient_id: string;
  monitoring_week: number;
  next_blood_due_date: string;
  prescriber_staff_id: string;
  primary_clinician_id: string | null;
}

export interface ClozapineMonitoringWeekEmitInput {
  clinicId: string;
  userId: string;
  severity: 'warning' | 'critical';
  category: 'clozapine';
  title: string;
  body: string;
  actionUrl: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

export interface ClozapineMonitoringWeekContext {
  listDueWithinWindow(now: Date): Promise<ClozapineMonitoringWeekRow[]>;
  emit(input: ClozapineMonitoringWeekEmitInput): Promise<{ ids: string[]; published: boolean }>;
  resolveActiveRecipients(
    clinicId: string,
    prescriberStaffId: string,
    primaryClinicianId: string | null,
  ): Promise<{ active: string[]; reassignedToAdmin: string | null }>;
  writeAuditLogRow(input: {
    clinicId: string;
    action:
      | 'CLOZAPINE_MONITORING_WEEK_RECIPIENT_REASSIGNED'
      | 'CLOZAPINE_MONITORING_WEEK_NO_RECIPIENT_AVAILABLE';
    registrationId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

export interface ClozapineMonitoringWeekOutcome {
  processed: number;
  emitted: number;
  errors: number;
}

export function bucketForNextBloodDueDate(
  nextBloodDueDate: string,
  now: Date,
): ClozapineMonitoringWeekBucket | null {
  const due = new Date(`${String(nextBloodDueDate).slice(0, 10)}T00:00:00.000Z`);
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (diffDays < 0) return 'T+overdue';
  if (diffDays === 0) return 'T-0d';
  if (diffDays === 1) return 'T-1d';
  if (diffDays === 3) return 'T-3d';
  return null;
}

export function severityForClozapineMonitoringWeekBucket(
  bucket: ClozapineMonitoringWeekBucket,
): 'warning' | 'critical' {
  return bucket === 'T-3d' ? 'warning' : 'critical';
}

export function dedupeKeyForClozapineMonitoringWeekAlert(
  registrationId: string,
  staffId: string,
  bucket: ClozapineMonitoringWeekBucket,
  now: Date,
): string {
  const day = now.toISOString().slice(0, 10);
  return `clozapine-monitoring-week:${registrationId}:${staffId}:${bucket}:fired-day:${day}`;
}

function titleForBucket(
  monitoringWeek: number,
  bucket: ClozapineMonitoringWeekBucket,
): string {
  if (bucket === 'T+overdue') return `Clozapine monitoring overdue — Week ${monitoringWeek}`;
  if (bucket === 'T-0d') return `Clozapine monitoring due today — Week ${monitoringWeek}`;
  if (bucket === 'T-1d') return `Clozapine monitoring due tomorrow — Week ${monitoringWeek}`;
  return `Clozapine monitoring due in 3 days — Week ${monitoringWeek}`;
}

export async function processClozapineMonitoringWeekAlerts(
  now: Date,
  ctx: ClozapineMonitoringWeekContext,
): Promise<ClozapineMonitoringWeekOutcome> {
  const out: ClozapineMonitoringWeekOutcome = { processed: 0, emitted: 0, errors: 0 };
  let rows: ClozapineMonitoringWeekRow[] = [];
  try {
    rows = await ctx.listDueWithinWindow(now);
  } catch (err) {
    ctx.logger.error({ err }, 'clozapineMonitoringWeekScheduler top-level listDueWithinWindow failed');
    return out;
  }

  if (rows.length === 0) {
    ctx.logger.warn(
      { kind: 'CLOZAPINE_MONITORING_WEEK_ZERO_ROWS', tickAt: now.toISOString() },
      'clozapineMonitoringWeekScheduler returned zero rows (either no rows in window or access-path failure)',
    );
  }

  for (const row of rows) {
    out.processed++;
    try {
      const bucket = bucketForNextBloodDueDate(row.next_blood_due_date, now);
      if (!bucket) continue;

      const { active, reassignedToAdmin } = await ctx.resolveActiveRecipients(
        row.clinic_id,
        row.prescriber_staff_id,
        row.primary_clinician_id,
      );

      if (reassignedToAdmin) {
        ctx.logger.warn(
          {
            kind: 'CLOZAPINE_MONITORING_WEEK_RECIPIENT_REASSIGNED_TO_ADMIN',
            registrationId: row.registration_id,
            clinicId: row.clinic_id,
            adminStaffId: reassignedToAdmin,
            prescriberStaffId: row.prescriber_staff_id,
            primaryClinicianId: row.primary_clinician_id,
            monitoringWeek: row.monitoring_week,
            bucket,
          },
          'Clozapine monitoring-week recipients inactive; reassigned to clinic admin',
        );
        await ctx.writeAuditLogRow({
          clinicId: row.clinic_id,
          action: 'CLOZAPINE_MONITORING_WEEK_RECIPIENT_REASSIGNED',
          registrationId: row.registration_id,
          metadata: {
            prescriber_staff_id: row.prescriber_staff_id,
            primary_clinician_id: row.primary_clinician_id,
            admin_staff_id: reassignedToAdmin,
            monitoring_week: row.monitoring_week,
            bucket,
            reason: 'inactive_recipients',
            system_actor: 'clozapine-monitoring-week-scheduler',
          },
        });
      }

      if (active.length === 0) {
        ctx.logger.error(
          {
            kind: 'CLOZAPINE_MONITORING_WEEK_NO_RECIPIENT_AVAILABLE',
            registrationId: row.registration_id,
            clinicId: row.clinic_id,
            prescriberStaffId: row.prescriber_staff_id,
            primaryClinicianId: row.primary_clinician_id,
            monitoringWeek: row.monitoring_week,
            bucket,
          },
          'Clozapine monitoring-week alert had no active recipient and no admin fallback; skipped emit',
        );
        await ctx.writeAuditLogRow({
          clinicId: row.clinic_id,
          action: 'CLOZAPINE_MONITORING_WEEK_NO_RECIPIENT_AVAILABLE',
          registrationId: row.registration_id,
          metadata: {
            prescriber_staff_id: row.prescriber_staff_id,
            primary_clinician_id: row.primary_clinician_id,
            monitoring_week: row.monitoring_week,
            bucket,
            reason: 'no_admin_configured',
            system_actor: 'clozapine-monitoring-week-scheduler',
          },
        });
        continue;
      }

      const severity = severityForClozapineMonitoringWeekBucket(bucket);
      for (const staffId of active) {
        await ctx.emit({
          clinicId: row.clinic_id,
          userId: staffId,
          severity,
          category: 'clozapine',
          title: titleForBucket(row.monitoring_week, bucket),
          body: `Clozapine monitoring week ${row.monitoring_week} review point is ${bucket === 'T+overdue' ? 'overdue' : `due on ${String(row.next_blood_due_date).slice(0, 10)}`}. Confirm weekly review and blood-monitoring follow-up for weeks 1-18.`,
          actionUrl: `/patients/${row.patient_id}/clozapine`,
          payload: {
            registration_id: row.registration_id,
            patient_id: row.patient_id,
            monitoring_week: row.monitoring_week,
            next_blood_due_date: row.next_blood_due_date,
            bucket,
            system_actor: 'clozapine-monitoring-week-scheduler',
          },
          dedupeKey: dedupeKeyForClozapineMonitoringWeekAlert(
            row.registration_id,
            staffId,
            bucket,
            now,
          ),
        });
        out.emitted++;
      }
    } catch (err) {
      out.errors++;
      ctx.logger.error(
        { err, registrationId: row.registration_id },
        'clozapineMonitoringWeekScheduler row failed',
      );
    }
  }

  return out;
}

export async function buildLiveContext(): Promise<ClozapineMonitoringWeekContext> {
  return {
    async listDueWithinWindow(_now: Date): Promise<ClozapineMonitoringWeekRow[]> {
      const rows = await dbAdmin('clozapine_registrations as cr')
        .leftJoin('patients as p', function () {
          this.on('p.id', '=', 'cr.patient_id')
            .andOn('p.clinic_id', '=', 'cr.clinic_id')
            .andOnNull('p.deleted_at');
        })
        .leftJoin('episodes as ep', function () {
          this.on('ep.id', '=', 'cr.episode_id')
            .andOn('ep.clinic_id', '=', 'cr.clinic_id')
            .andOnNull('ep.deleted_at');
        })
        // Fallback to patient's CURRENT active episode primary clinician
        // when the registration's original episode is closed/deleted.
        .joinRaw(`
          LEFT JOIN LATERAL (
            SELECT cur_ep.primary_clinician_id
            FROM episodes AS cur_ep
            WHERE cur_ep.patient_id = cr.patient_id
              AND cur_ep.clinic_id = cr.clinic_id
              AND cur_ep.status = 'open'
              AND cur_ep.deleted_at IS NULL
            ORDER BY cur_ep.start_date DESC
            LIMIT 1
          ) AS cur_ep ON TRUE
        `)
        .whereNull('cr.deleted_at')
        .whereNull('cr.ceased_date')
        .whereNotNull('cr.prescriber_staff_id')
        .whereNotNull('cr.next_blood_due_date')
        .whereNotNull('p.id')
        .whereBetween('cr.monitoring_week', [1, 18])
        // Bounded window: upcoming 3 days + overdue up to 30 days.
        .whereRaw("cr.next_blood_due_date BETWEEN (CURRENT_DATE - INTERVAL '30 days') AND (CURRENT_DATE + INTERVAL '3 days')")
        .select(
          'cr.id as registration_id',
          'cr.clinic_id',
          'cr.patient_id',
          'cr.monitoring_week',
          'cr.next_blood_due_date',
          'cr.prescriber_staff_id',
          dbAdmin.raw(
            'COALESCE(ep.primary_clinician_id, cur_ep.primary_clinician_id) as primary_clinician_id',
          ),
        );
      return rows as ClozapineMonitoringWeekRow[];
    },

    async emit(input) {
      return emitSchedulerSignal({
        clinicId: input.clinicId,
        userId: input.userId,
        severity: input.severity,
        category: input.category,
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl,
        payload: input.payload,
        dedupeKey: input.dedupeKey,
        signalKey: 'clozapine_monitoring_week_due',
      });
    },

    async resolveActiveRecipients(clinicId, prescriberStaffId, primaryClinicianId) {
      const candidates = primaryClinicianId
        ? [prescriberStaffId, primaryClinicianId]
        : [prescriberStaffId];
      const uniqueCandidates = Array.from(new Set(candidates));
      const staffRows = await dbAdmin('staff')
        .where({ clinic_id: clinicId })
        .whereNull('deleted_at')
        .whereIn('id', uniqueCandidates)
        .select('id', 'is_active', 'deleted_at');
      const active: string[] = [];
      for (const id of uniqueCandidates) {
        const row = staffRows.find((s) => s.id === id);
        if (row && row.is_active && !row.deleted_at) active.push(id);
      }
      if (active.length > 0) return { active, reassignedToAdmin: null };

      const clinic = await dbAdmin('clinics')
        .where({ id: clinicId })
        .whereNull('deleted_at')
        .select('nominated_admin_staff_id', 'delegated_admin_staff_id')
        .first();
      const adminId = clinic?.nominated_admin_staff_id ?? clinic?.delegated_admin_staff_id ?? null;
      return { active: adminId ? [adminId] : [], reassignedToAdmin: adminId };
    },

    async writeAuditLogRow({ clinicId, action, registrationId, metadata }) {
      await writeAuditLog({
        clinicId,
        actorId: 'system:clozapine-monitoring-week-scheduler',
        action,
        tableName: 'clozapine_registrations',
        recordId: registrationId,
        newData: metadata,
      });
    },

    logger: defaultLogger,
  };
}

const clozapineMonitoringWeekTask = cron.schedule('20 7 * * *', async () => {
  defaultLogger.info('Running clozapine monitoring-week scheduler');
  try {
    const ctx = await buildLiveContext();
    const out = await processClozapineMonitoringWeekAlerts(new Date(), ctx);
    defaultLogger.info(out, 'clozapine monitoring-week scheduler tick complete');
  } catch (err) {
    defaultLogger.error({ err }, 'clozapine monitoring-week scheduler failed');
  }
}, { timezone: 'Australia/Melbourne' });

if (process.env.NODE_ENV !== 'test') {
  registerShutdownHook({
    name: 'scheduler:clozapine-monitoring-week',
    priority: 84,
    handler: async () => { clozapineMonitoringWeekTask.stop(); },
  });
}

export { clozapineMonitoringWeekTask };
