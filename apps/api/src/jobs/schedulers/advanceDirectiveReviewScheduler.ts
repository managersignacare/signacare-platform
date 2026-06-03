// apps/api/src/jobs/schedulers/advanceDirectiveReviewScheduler.ts
//
// BUG-573 — advance-directive review-by alert scheduler.
//
// Daily 07:10 AEST cron scans active `advance_directives` whose review
// horizon (schema-truth: `valid_until`) falls into a bounded window and
// emits reminders to the responsible clinician:
//   - T-30d / T-14d / T-7d / T-1d
//   - T+overdue
//
// Schema-truth note:
// BUG text referenced `advance_directives.review_date`; current schema
// stores the review-by axis as `advance_directives.valid_until`.
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

export type AdvanceDirectiveReviewBucket =
  | 'T-30d'
  | 'T-14d'
  | 'T-7d'
  | 'T-1d'
  | 'T+overdue';

/**
 * @schema-drift-exempt select-aliased
 * BUG-573 — scheduler row shape is select-aliased across
 * `advance_directives` + current-team fallback JOINs.
 */
export interface AdvanceDirectiveReviewRow {
  directive_id: string;
  clinic_id: string;
  patient_id: string;
  directive_type: string;
  status: string;
  valid_until: string;
  primary_clinician_id: string | null;
}

export interface AdvanceDirectiveReviewEmitInput {
  clinicId: string;
  userId: string;
  severity: 'warning' | 'critical';
  category: 'advance_directive';
  title: string;
  body: string;
  actionUrl: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

export interface AdvanceDirectiveReviewContext {
  listReviewDueWithinWindow(now: Date): Promise<AdvanceDirectiveReviewRow[]>;
  emit(input: AdvanceDirectiveReviewEmitInput): Promise<{ ids: string[]; published: boolean }>;
  resolveActiveRecipients(
    clinicId: string,
    primaryClinicianId: string | null,
  ): Promise<{ active: string[]; reassignedToAdmin: string | null }>;
  writeAuditLogRow(input: {
    clinicId: string;
    action:
      | 'ADVANCE_DIRECTIVE_REVIEW_RECIPIENT_REASSIGNED'
      | 'ADVANCE_DIRECTIVE_REVIEW_NO_RECIPIENT_AVAILABLE';
    directiveId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

export interface AdvanceDirectiveReviewOutcome {
  processed: number;
  emitted: number;
  errors: number;
}

export function bucketForValidUntilDate(
  validUntil: string,
  now: Date,
): AdvanceDirectiveReviewBucket | null {
  const due = new Date(`${String(validUntil).slice(0, 10)}T00:00:00.000Z`);
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (diffDays < 0) return 'T+overdue';
  if (diffDays === 1) return 'T-1d';
  if (diffDays === 7) return 'T-7d';
  if (diffDays === 14) return 'T-14d';
  if (diffDays === 30) return 'T-30d';
  return null;
}

export function severityForAdvanceDirectiveBucket(
  bucket: AdvanceDirectiveReviewBucket,
): 'warning' | 'critical' {
  return bucket === 'T-1d' || bucket === 'T+overdue' ? 'critical' : 'warning';
}

export function dedupeKeyForAdvanceDirectiveReview(
  directiveId: string,
  staffId: string,
  bucket: AdvanceDirectiveReviewBucket,
  now: Date,
): string {
  const day = now.toISOString().slice(0, 10);
  return `advance-directive-review:${directiveId}:${staffId}:${bucket}:fired-day:${day}`;
}

function titleForBucket(
  directiveType: string,
  bucket: AdvanceDirectiveReviewBucket,
): string {
  if (bucket === 'T+overdue') return `Advance directive review overdue — ${directiveType}`;
  if (bucket === 'T-1d') return `Advance directive review due tomorrow — ${directiveType}`;
  if (bucket === 'T-7d') return `Advance directive review due in 7 days — ${directiveType}`;
  if (bucket === 'T-14d') return `Advance directive review due in 14 days — ${directiveType}`;
  return `Advance directive review due in 30 days — ${directiveType}`;
}

export async function processAdvanceDirectiveReviewAlerts(
  now: Date,
  ctx: AdvanceDirectiveReviewContext,
): Promise<AdvanceDirectiveReviewOutcome> {
  const out: AdvanceDirectiveReviewOutcome = { processed: 0, emitted: 0, errors: 0 };
  let rows: AdvanceDirectiveReviewRow[] = [];
  try {
    rows = await ctx.listReviewDueWithinWindow(now);
  } catch (err) {
    ctx.logger.error({ err }, 'advanceDirectiveReviewScheduler top-level listReviewDueWithinWindow failed');
    return out;
  }

  if (rows.length === 0) {
    ctx.logger.warn(
      { kind: 'ADVANCE_DIRECTIVE_REVIEW_ZERO_ROWS', tickAt: now.toISOString() },
      'advanceDirectiveReviewScheduler returned zero rows (either no directives in window or access-path failure)',
    );
  }

  for (const row of rows) {
    out.processed++;

    try {
      const bucket = bucketForValidUntilDate(row.valid_until, now);
      if (!bucket) continue;

      const { active, reassignedToAdmin } = await ctx.resolveActiveRecipients(
        row.clinic_id,
        row.primary_clinician_id,
      );

      if (reassignedToAdmin) {
        ctx.logger.warn(
          {
            kind: 'ADVANCE_DIRECTIVE_REVIEW_RECIPIENT_REASSIGNED_TO_ADMIN',
            directiveId: row.directive_id,
            clinicId: row.clinic_id,
            primaryClinicianId: row.primary_clinician_id,
            adminStaffId: reassignedToAdmin,
            bucket,
          },
          'Advance-directive review recipients inactive; reassigned to clinic admin',
        );
        await ctx.writeAuditLogRow({
          clinicId: row.clinic_id,
          action: 'ADVANCE_DIRECTIVE_REVIEW_RECIPIENT_REASSIGNED',
          directiveId: row.directive_id,
          metadata: {
            primary_clinician_id: row.primary_clinician_id,
            admin_staff_id: reassignedToAdmin,
            bucket,
            reason: 'inactive_recipients',
            system_actor: 'advance-directive-review-scheduler',
          },
        });
      }

      if (active.length === 0) {
        ctx.logger.error(
          {
            kind: 'ADVANCE_DIRECTIVE_REVIEW_NO_RECIPIENT_AVAILABLE',
            directiveId: row.directive_id,
            clinicId: row.clinic_id,
            primaryClinicianId: row.primary_clinician_id,
            bucket,
          },
          'Advance-directive review alert had no active recipient and no admin fallback; skipped emit',
        );
        await ctx.writeAuditLogRow({
          clinicId: row.clinic_id,
          action: 'ADVANCE_DIRECTIVE_REVIEW_NO_RECIPIENT_AVAILABLE',
          directiveId: row.directive_id,
          metadata: {
            primary_clinician_id: row.primary_clinician_id,
            bucket,
            reason: 'no_admin_configured',
            system_actor: 'advance-directive-review-scheduler',
          },
        });
        continue;
      }

      const severity = severityForAdvanceDirectiveBucket(bucket);
      for (const staffId of active) {
        await ctx.emit({
          clinicId: row.clinic_id,
          userId: staffId,
          severity,
          category: 'advance_directive',
          title: titleForBucket(row.directive_type, bucket),
          body: `Advance directive ${row.directive_type} is ${bucket === 'T+overdue' ? 'overdue for review' : `due for review on ${String(row.valid_until).slice(0, 10)}`}. Review with patient and renew/update as clinically indicated.`,
          actionUrl: `/patients/${row.patient_id}`,
          payload: {
            directive_id: row.directive_id,
            patient_id: row.patient_id,
            directive_type: row.directive_type,
            status: row.status,
            valid_until: row.valid_until,
            bucket,
            system_actor: 'advance-directive-review-scheduler',
          },
          dedupeKey: dedupeKeyForAdvanceDirectiveReview(
            row.directive_id,
            staffId,
            bucket,
            now,
          ),
        });
        out.emitted++;
      }
    } catch (err) {
      out.errors++;
      ctx.logger.error({ err, directiveId: row.directive_id }, 'advanceDirectiveReviewScheduler row failed');
    }
  }

  return out;
}

export async function buildLiveContext(): Promise<AdvanceDirectiveReviewContext> {
  return {
    async listReviewDueWithinWindow(_now: Date): Promise<AdvanceDirectiveReviewRow[]> {
      const rows = await dbAdmin('advance_directives as ad')
        .leftJoin('patients as p', function () {
          this.on('p.id', '=', 'ad.patient_id')
            .andOn('p.clinic_id', '=', 'ad.clinic_id')
            .andOnNull('p.deleted_at');
        })
        .joinRaw(`
          LEFT JOIN LATERAL (
            SELECT cur_ep.primary_clinician_id
            FROM episodes AS cur_ep
            WHERE cur_ep.patient_id = ad.patient_id
              AND cur_ep.clinic_id = ad.clinic_id
              AND cur_ep.status = 'open'
              AND cur_ep.deleted_at IS NULL
            ORDER BY cur_ep.start_date DESC
            LIMIT 1
          ) AS cur_ep ON TRUE
        `)
        .joinRaw(`
          LEFT JOIN LATERAL (
            SELECT pta.primary_clinician_id
            FROM patient_team_assignments AS pta
            WHERE pta.patient_id = ad.patient_id
              AND pta.is_active = true
              AND pta.primary_clinician_id IS NOT NULL
            ORDER BY pta.updated_at DESC NULLS LAST, pta.created_at DESC
            LIMIT 1
          ) AS pta_latest ON TRUE
        `)
        .where({ 'ad.status': 'active' })
        .whereNotNull('ad.valid_until')
        .whereNotNull('p.id')
        .whereRaw("ad.valid_until BETWEEN (CURRENT_DATE - INTERVAL '30 days') AND (CURRENT_DATE + INTERVAL '30 days')")
        .select(
          'ad.id as directive_id',
          'ad.clinic_id',
          'ad.patient_id',
          'ad.type as directive_type',
          'ad.status',
          'ad.valid_until',
          dbAdmin.raw(
            'COALESCE(cur_ep.primary_clinician_id, pta_latest.primary_clinician_id) as primary_clinician_id',
          ),
        );
      return rows as AdvanceDirectiveReviewRow[];
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
        signalKey: 'advance_directive_review_due',
      });
    },

    async resolveActiveRecipients(clinicId, primaryClinicianId) {
      const uniqueCandidates = primaryClinicianId ? [primaryClinicianId] : [];
      if (uniqueCandidates.length > 0) {
        const staffRows = await dbAdmin('staff')
          .where({ clinic_id: clinicId })
          .whereNull('deleted_at')
          .whereIn('id', uniqueCandidates)
          .select('id', 'is_active', 'deleted_at');
        const active = uniqueCandidates.filter((id) => {
          const row = staffRows.find((s) => s.id === id);
          return Boolean(row && row.is_active && !row.deleted_at);
        });
        if (active.length > 0) {
          return { active, reassignedToAdmin: null };
        }
      }

      const clinic = await dbAdmin('clinics')
        .where({ id: clinicId })
        .whereNull('deleted_at')
        .select('nominated_admin_staff_id', 'delegated_admin_staff_id')
        .first();
      const adminId = clinic?.nominated_admin_staff_id ?? clinic?.delegated_admin_staff_id ?? null;
      return { active: adminId ? [adminId] : [], reassignedToAdmin: adminId };
    },

    async writeAuditLogRow({ clinicId, action, directiveId, metadata }) {
      await writeAuditLog({
        clinicId,
        actorId: 'system:advance-directive-review-scheduler',
        action,
        tableName: 'advance_directives',
        recordId: directiveId,
        newData: metadata,
      });
    },

    logger: defaultLogger,
  };
}

const advanceDirectiveReviewTask = cron.schedule('10 7 * * *', async () => {
  defaultLogger.info('Running advance-directive review scheduler');
  try {
    const ctx = await buildLiveContext();
    const out = await processAdvanceDirectiveReviewAlerts(new Date(), ctx);
    defaultLogger.info(out, 'Advance-directive review scheduler tick complete');
  } catch (err) {
    defaultLogger.error({ err }, 'Advance-directive review scheduler failed');
  }
}, { timezone: 'Australia/Melbourne' });

if (process.env.NODE_ENV !== 'test') {
  registerShutdownHook({
    name: 'scheduler:advance-directive-review',
    priority: 85,
    handler: async () => { advanceDirectiveReviewTask.stop(); },
  });
}

export { advanceDirectiveReviewTask };
