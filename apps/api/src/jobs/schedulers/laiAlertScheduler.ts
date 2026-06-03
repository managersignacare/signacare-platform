// apps/api/src/jobs/schedulers/laiAlertScheduler.ts
//
// BUG-570 — LAI due-alert scheduler.
//
// Daily 07:00 AEST cron scans active `lai_schedules` with
// `next_due_date` in a bounded window and emits reminders to the
// responsible clinicians:
//   - T-7d / T-3d / T-1d upcoming buckets
//   - T+overdue bucket
//
// Source-of-truth note:
// pre-fix BUG text referenced `patient_medications.next_dose_due`, but
// current schema stores LAI cadence in `lai_schedules.next_due_date`.
// This scheduler uses `lai_schedules` as the canonical surface.
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

// ── Types ──────────────────────────────────────────────────────────────────

export type LaiAlertBucket = 'T-7d' | 'T-3d' | 'T-1d' | 'T+overdue';

/**
 * @schema-drift-exempt select-aliased
 * BUG-570 — scheduler row shape is select-aliased across `lai_schedules`
 * + fallback episode JOINs; not a 1:1 table row.
 */
export interface LaiAlertRow {
  schedule_id: string;
  clinic_id: string;
  patient_id: string;
  drug_name: string;
  next_due_date: string;
  prescriber_staff_id: string;
  primary_clinician_id: string | null;
}

export interface LaiAlertEmitInput {
  clinicId: string;
  userId: string;
  severity: 'warning' | 'critical';
  category: 'lai';
  title: string;
  body: string;
  actionUrl: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

export interface LaiAlertContext {
  listDueWithinWindow(now: Date): Promise<LaiAlertRow[]>;
  emit(input: LaiAlertEmitInput): Promise<{ ids: string[]; published: boolean }>;
  resolveActiveRecipients(
    clinicId: string,
    prescriberStaffId: string,
    primaryClinicianId: string | null,
  ): Promise<{ active: string[]; reassignedToAdmin: string | null }>;
  writeAuditLogRow(input: {
    clinicId: string;
    action: 'LAI_DUE_RECIPIENT_REASSIGNED' | 'LAI_DUE_NO_RECIPIENT_AVAILABLE';
    scheduleId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

export interface LaiAlertOutcome {
  processed: number;
  emitted: number;
  errors: number;
}

// ── Pure helpers ───────────────────────────────────────────────────────────

export function bucketForNextDueDate(nextDueDate: string, now: Date): LaiAlertBucket | null {
  const due = new Date(`${String(nextDueDate).slice(0, 10)}T00:00:00.000Z`);
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (diffDays < 0) return 'T+overdue';
  if (diffDays === 1) return 'T-1d';
  if (diffDays === 3) return 'T-3d';
  if (diffDays === 7) return 'T-7d';
  return null;
}

export function severityForLaiBucket(bucket: LaiAlertBucket): 'warning' | 'critical' {
  return bucket === 'T-1d' || bucket === 'T+overdue' ? 'critical' : 'warning';
}

export function dedupeKeyForLaiAlert(
  scheduleId: string,
  staffId: string,
  bucket: LaiAlertBucket,
  now: Date,
): string {
  const day = now.toISOString().slice(0, 10);
  return `lai-dose-due:${scheduleId}:${staffId}:${bucket}:fired-day:${day}`;
}

function titleForBucket(drugName: string, bucket: LaiAlertBucket): string {
  if (bucket === 'T+overdue') return `LAI dose overdue — ${drugName}`;
  if (bucket === 'T-1d') return `LAI due tomorrow — ${drugName}`;
  if (bucket === 'T-3d') return `LAI due in 3 days — ${drugName}`;
  return `LAI due in 7 days — ${drugName}`;
}

// ── Processor ──────────────────────────────────────────────────────────────

export async function processLaiDueAlerts(
  now: Date,
  ctx: LaiAlertContext,
): Promise<LaiAlertOutcome> {
  const out: LaiAlertOutcome = { processed: 0, emitted: 0, errors: 0 };
  let rows: LaiAlertRow[] = [];
  try {
    rows = await ctx.listDueWithinWindow(now);
  } catch (err) {
    ctx.logger.error({ err }, 'laiAlertScheduler top-level listDueWithinWindow failed');
    return out;
  }

  if (rows.length === 0) {
    ctx.logger.warn(
      { kind: 'LAI_ALERT_ZERO_ROWS', tickAt: now.toISOString() },
      'laiAlertScheduler returned zero rows (either no due schedules or access-path failure)',
    );
  }

  for (const row of rows) {
    out.processed++;

    try {
      const bucket = bucketForNextDueDate(row.next_due_date, now);
      if (!bucket) continue;

      const { active, reassignedToAdmin } = await ctx.resolveActiveRecipients(
        row.clinic_id,
        row.prescriber_staff_id,
        row.primary_clinician_id,
      );

      if (reassignedToAdmin) {
        ctx.logger.warn(
          {
            kind: 'LAI_DUE_RECIPIENT_REASSIGNED_TO_ADMIN',
            scheduleId: row.schedule_id,
            clinicId: row.clinic_id,
            adminStaffId: reassignedToAdmin,
            prescriberStaffId: row.prescriber_staff_id,
            primaryClinicianId: row.primary_clinician_id,
            bucket,
          },
          'LAI due-alert recipients inactive; reassigned to clinic admin',
        );
        await ctx.writeAuditLogRow({
          clinicId: row.clinic_id,
          action: 'LAI_DUE_RECIPIENT_REASSIGNED',
          scheduleId: row.schedule_id,
          metadata: {
            prescriber_staff_id: row.prescriber_staff_id,
            primary_clinician_id: row.primary_clinician_id,
            admin_staff_id: reassignedToAdmin,
            bucket,
            reason: 'inactive_recipients',
            system_actor: 'lai-alert-scheduler',
          },
        });
      }

      if (active.length === 0) {
        ctx.logger.error(
          {
            kind: 'LAI_DUE_NO_RECIPIENT_AVAILABLE',
            scheduleId: row.schedule_id,
            clinicId: row.clinic_id,
            prescriberStaffId: row.prescriber_staff_id,
            primaryClinicianId: row.primary_clinician_id,
            bucket,
          },
          'LAI due alert had no active recipient and no admin fallback; skipped emit',
        );
        await ctx.writeAuditLogRow({
          clinicId: row.clinic_id,
          action: 'LAI_DUE_NO_RECIPIENT_AVAILABLE',
          scheduleId: row.schedule_id,
          metadata: {
            prescriber_staff_id: row.prescriber_staff_id,
            primary_clinician_id: row.primary_clinician_id,
            bucket,
            reason: 'no_admin_configured',
            system_actor: 'lai-alert-scheduler',
          },
        });
        continue;
      }

      const severity = severityForLaiBucket(bucket);
      for (const staffId of active) {
        await ctx.emit({
          clinicId: row.clinic_id,
          userId: staffId,
          severity,
          category: 'lai',
          title: titleForBucket(row.drug_name, bucket),
          body: `LAI schedule for ${row.drug_name} is ${bucket === 'T+overdue' ? 'overdue' : `due ${String(row.next_due_date).slice(0, 10)}`}. Review adherence and administer/reschedule as clinically indicated.`,
          actionUrl: `/patients/${row.patient_id}`,
          payload: {
            schedule_id: row.schedule_id,
            patient_id: row.patient_id,
            next_due_date: row.next_due_date,
            drug_name: row.drug_name,
            bucket,
            system_actor: 'lai-alert-scheduler',
          },
          dedupeKey: dedupeKeyForLaiAlert(row.schedule_id, staffId, bucket, now),
        });
        out.emitted++;
      }
    } catch (err) {
      out.errors++;
      ctx.logger.error({ err, scheduleId: row.schedule_id }, 'laiAlertScheduler row failed');
    }
  }

  return out;
}

// ── Live-context construction ──────────────────────────────────────────────

export async function buildLiveContext(): Promise<LaiAlertContext> {
  return {
    async listDueWithinWindow(_now: Date): Promise<LaiAlertRow[]> {
      const rows = await dbAdmin('lai_schedules as ls')
        .leftJoin('patients as p', function () {
          this.on('p.id', '=', 'ls.patient_id')
            .andOn('p.clinic_id', '=', 'ls.clinic_id')
            .andOnNull('p.deleted_at');
        })
        .leftJoin('episodes as ep', function () {
          this.on('ep.id', '=', 'ls.episode_id')
            .andOn('ep.clinic_id', '=', 'ls.clinic_id')
            .andOnNull('ep.deleted_at');
        })
        // Fallback to patient's CURRENT active episode primary clinician
        // when the schedule's original episode is closed/deleted.
        .joinRaw(`
          LEFT JOIN LATERAL (
            SELECT cur_ep.primary_clinician_id
            FROM episodes AS cur_ep
            WHERE cur_ep.patient_id = ls.patient_id
              AND cur_ep.clinic_id = ls.clinic_id
              AND cur_ep.status = 'open'
              AND cur_ep.deleted_at IS NULL
            ORDER BY cur_ep.start_date DESC
            LIMIT 1
          ) AS cur_ep ON TRUE
        `)
        .where({ 'ls.status': 'active' })
        .whereNull('ls.deleted_at')
        .whereNotNull('ls.next_due_date')
        .whereNotNull('p.id')
        // Bounded window: upcoming 7 days + overdue up to 30 days.
        .whereRaw("ls.next_due_date BETWEEN (CURRENT_DATE - INTERVAL '30 days') AND (CURRENT_DATE + INTERVAL '7 days')")
        .select(
          'ls.id as schedule_id',
          'ls.clinic_id',
          'ls.patient_id',
          'ls.drug_name',
          'ls.next_due_date',
          'ls.prescriber_staff_id',
          dbAdmin.raw(
            'COALESCE(ep.primary_clinician_id, cur_ep.primary_clinician_id) as primary_clinician_id',
          ),
        );
      return rows as LaiAlertRow[];
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
        signalKey: 'lai_due_alert',
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
      if (active.length > 0) {
        return { active, reassignedToAdmin: null };
      }

      const clinic = await dbAdmin('clinics')
        .where({ id: clinicId })
        .whereNull('deleted_at')
        .select('nominated_admin_staff_id', 'delegated_admin_staff_id')
        .first();
      const adminId = clinic?.nominated_admin_staff_id ?? clinic?.delegated_admin_staff_id ?? null;
      return { active: adminId ? [adminId] : [], reassignedToAdmin: adminId };
    },

    async writeAuditLogRow({ clinicId, action, scheduleId, metadata }) {
      await writeAuditLog({
        clinicId,
        actorId: 'system:lai-alert-scheduler',
        action,
        tableName: 'lai_schedules',
        recordId: scheduleId,
        newData: metadata,
      });
    },

    logger: defaultLogger,
  };
}

// ── Cron tick ──────────────────────────────────────────────────────────────

const laiAlertTask = cron.schedule('0 7 * * *', async () => {
  defaultLogger.info('Running LAI due-alert scheduler');
  try {
    const ctx = await buildLiveContext();
    const out = await processLaiDueAlerts(new Date(), ctx);
    defaultLogger.info(out, 'LAI due-alert scheduler tick complete');
  } catch (err) {
    defaultLogger.error({ err }, 'LAI due-alert scheduler failed');
  }
}, { timezone: 'Australia/Melbourne' });

if (process.env.NODE_ENV !== 'test') {
  registerShutdownHook({
    name: 'scheduler:lai-due-alert',
    priority: 85,
    handler: async () => { laiAlertTask.stop(); },
  });
}

export { laiAlertTask };
