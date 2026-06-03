// apps/api/src/jobs/schedulers/ectConsentExpiryScheduler.ts
//
// BUG-572 — ECT consent expiry alert scheduler.
//
// Daily 07:30 AEST cron scans active/planned `ect_courses` and derives
// consent expiry from schema-truth fields:
//   expiry_date = consent_date + ect_consent_validity_days
// where `ect_consent_validity_days` is clinic-configurable via
// settingsService thresholds (default 180 days).
//
// Emits reminders when consent is:
//   - within 7 days of expiry (warning)
//   - already lapsed (critical)
//
// Source-of-truth correction:
// pre-fix BUG text referenced non-existent `ect_treatments` and
// `consent_expires_at` columns. Current schema uses `ect_courses` with
// `consent_date` + `consent_obtained`.
//
// SCHEDULER ONLY — uses `dbAdmin` per BUG-583 (RLS-closed query/insert
// paths outside request context). Tenant scoping is preserved through
// FK-bound `clinic_id` carried into every emit.

import cron from 'node-cron';
import { dbAdmin } from '../../db/db';
import { logger as defaultLogger } from '../../utils/logger';
import { registerShutdownHook } from '../../shared/gracefulShutdown';
import { writeAuditLog } from '../../utils/audit';
import { settingsService } from '../../features/settings/settingsService';
import { emitSchedulerSignal } from './schedulerSignalEmitter';

const ECT_CONSENT_WARNING_DAYS = 7;

export type EctConsentBucket = 'T-7d' | 'T+overdue';

/**
 * @schema-drift-exempt select-aliased
 * BUG-572 — scheduler row shape is select-aliased across
 * `ect_courses` + fallback current-episode JOINs.
 */
export interface EctConsentRow {
  course_id: string;
  clinic_id: string;
  patient_id: string;
  status: string;
  consent_date: string | Date;
  treating_psychiatrist_id: string;
  primary_clinician_id: string | null;
}

export interface EctConsentEmitInput {
  clinicId: string;
  userId: string;
  severity: 'warning' | 'critical';
  category: 'ect-consent';
  title: string;
  body: string;
  actionUrl: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

export interface EctConsentExpiryContext {
  listConsentCourses(now: Date): Promise<EctConsentRow[]>;
  getConsentValidityDays(clinicId: string): Promise<number>;
  emit(input: EctConsentEmitInput): Promise<{ ids: string[]; published: boolean }>;
  resolveActiveRecipients(
    clinicId: string,
    treatingPsychiatristId: string,
    primaryClinicianId: string | null,
  ): Promise<{ active: string[]; reassignedToAdmin: string | null }>;
  writeAuditLogRow(input: {
    clinicId: string;
    action:
      | 'ECT_CONSENT_RECIPIENT_REASSIGNED'
      | 'ECT_CONSENT_NO_RECIPIENT_AVAILABLE';
    courseId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

export interface EctConsentExpiryOutcome {
  processed: number;
  emitted: number;
  errors: number;
}

function toUtcMidnight(value: string | Date): Date {
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return new Date(`${iso}T00:00:00.000Z`);
}

function addDaysUtc(base: Date, days: number): Date {
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function consentExpiryDate(consentDate: string | Date, validityDays: number): string {
  const consent = toUtcMidnight(consentDate);
  return addDaysUtc(consent, validityDays).toISOString().slice(0, 10);
}

export function bucketForConsentExpiryDate(
  expiryDate: string,
  now: Date,
): EctConsentBucket | null {
  const exp = toUtcMidnight(expiryDate);
  const today = toUtcMidnight(now);
  const diffDays = Math.round((exp.getTime() - today.getTime()) / 86_400_000);

  if (diffDays < 0) return 'T+overdue';
  if (diffDays <= ECT_CONSENT_WARNING_DAYS) return 'T-7d';
  return null;
}

export function severityForEctConsentBucket(
  bucket: EctConsentBucket,
): 'warning' | 'critical' {
  return bucket === 'T+overdue' ? 'critical' : 'warning';
}

export function dedupeKeyForEctConsentExpiry(
  courseId: string,
  staffId: string,
  bucket: EctConsentBucket,
  expiryDate: string,
  now: Date,
): string {
  const day = now.toISOString().slice(0, 10);
  return `ect-consent-expiry:${courseId}:${staffId}:${bucket}:expires:${expiryDate}:fired-day:${day}`;
}

function titleForBucket(expiryDate: string, bucket: EctConsentBucket, now: Date): string {
  if (bucket === 'T+overdue') {
    return `ECT consent expired — action required (${expiryDate})`;
  }
  const exp = toUtcMidnight(expiryDate);
  const today = toUtcMidnight(now);
  const diffDays = Math.round((exp.getTime() - today.getTime()) / 86_400_000);
  return `ECT consent expires in ${diffDays} day(s) — re-consent required`;
}

export async function processEctConsentExpiryAlerts(
  now: Date,
  ctx: EctConsentExpiryContext,
): Promise<EctConsentExpiryOutcome> {
  const out: EctConsentExpiryOutcome = { processed: 0, emitted: 0, errors: 0 };
  let rows: EctConsentRow[] = [];
  try {
    rows = await ctx.listConsentCourses(now);
  } catch (err) {
    ctx.logger.error({ err }, 'ectConsentExpiryScheduler top-level listConsentCourses failed');
    return out;
  }

  if (rows.length === 0) {
    ctx.logger.warn(
      { kind: 'ECT_CONSENT_EXPIRY_ZERO_ROWS', tickAt: now.toISOString() },
      'ectConsentExpiryScheduler returned zero rows (either no active/planned courses or access-path failure)',
    );
  }

  const validityDaysCache = new Map<string, number>();

  for (const row of rows) {
    out.processed++;
    try {
      const consentDate = toUtcMidnight(row.consent_date).toISOString().slice(0, 10);
      let validityDays = validityDaysCache.get(row.clinic_id);
      if (validityDays == null) {
        validityDays = await ctx.getConsentValidityDays(row.clinic_id);
        validityDaysCache.set(row.clinic_id, validityDays);
      }

      const expiryDate = consentExpiryDate(row.consent_date, validityDays);
      const bucket = bucketForConsentExpiryDate(expiryDate, now);
      if (!bucket) continue;

      const { active, reassignedToAdmin } = await ctx.resolveActiveRecipients(
        row.clinic_id,
        row.treating_psychiatrist_id,
        row.primary_clinician_id,
      );

      if (reassignedToAdmin) {
        ctx.logger.warn(
          {
            kind: 'ECT_CONSENT_RECIPIENT_REASSIGNED_TO_ADMIN',
            courseId: row.course_id,
            clinicId: row.clinic_id,
            adminStaffId: reassignedToAdmin,
            treatingPsychiatristId: row.treating_psychiatrist_id,
            primaryClinicianId: row.primary_clinician_id,
            consentDate,
            consentExpiresAt: expiryDate,
            bucket,
          },
          'ECT consent-expiry recipients inactive; reassigned to clinic admin',
        );
        await ctx.writeAuditLogRow({
          clinicId: row.clinic_id,
          action: 'ECT_CONSENT_RECIPIENT_REASSIGNED',
          courseId: row.course_id,
          metadata: {
            treating_psychiatrist_id: row.treating_psychiatrist_id,
            primary_clinician_id: row.primary_clinician_id,
            admin_staff_id: reassignedToAdmin,
            consent_date: consentDate,
            consent_expires_at: expiryDate,
            bucket,
            reason: 'inactive_recipients',
            system_actor: 'ect-consent-expiry-scheduler',
          },
        });
      }

      if (active.length === 0) {
        ctx.logger.error(
          {
            kind: 'ECT_CONSENT_NO_RECIPIENT_AVAILABLE',
            courseId: row.course_id,
            clinicId: row.clinic_id,
            treatingPsychiatristId: row.treating_psychiatrist_id,
            primaryClinicianId: row.primary_clinician_id,
            consentDate,
            consentExpiresAt: expiryDate,
            bucket,
          },
          'ECT consent-expiry alert had no active recipient and no admin fallback; skipped emit',
        );
        await ctx.writeAuditLogRow({
          clinicId: row.clinic_id,
          action: 'ECT_CONSENT_NO_RECIPIENT_AVAILABLE',
          courseId: row.course_id,
          metadata: {
            treating_psychiatrist_id: row.treating_psychiatrist_id,
            primary_clinician_id: row.primary_clinician_id,
            consent_date: consentDate,
            consent_expires_at: expiryDate,
            bucket,
            reason: 'no_admin_configured',
            system_actor: 'ect-consent-expiry-scheduler',
          },
        });
        continue;
      }

      const severity = severityForEctConsentBucket(bucket);
      for (const staffId of active) {
        await ctx.emit({
          clinicId: row.clinic_id,
          userId: staffId,
          severity,
          category: 'ect-consent',
          title: titleForBucket(expiryDate, bucket, now),
          body:
            bucket === 'T+overdue'
              ? `ECT consent has lapsed (expired ${expiryDate}). Re-consent is required before further treatment; pause sessions until consent is re-established.`
              : `ECT consent expires on ${expiryDate}. Arrange re-consent before expiry; pause treatment if consent lapses.`,
          actionUrl: `/patients/${row.patient_id}`,
          payload: {
            course_id: row.course_id,
            patient_id: row.patient_id,
            course_status: row.status,
            consent_date: consentDate,
            consent_expires_at: expiryDate,
            bucket,
            system_actor: 'ect-consent-expiry-scheduler',
          },
          dedupeKey: dedupeKeyForEctConsentExpiry(
            row.course_id,
            staffId,
            bucket,
            expiryDate,
            now,
          ),
        });
        out.emitted++;
      }
    } catch (err) {
      out.errors++;
      ctx.logger.error({ err, courseId: row.course_id }, 'ectConsentExpiryScheduler row failed');
    }
  }

  return out;
}

export async function buildLiveContext(): Promise<EctConsentExpiryContext> {
  return {
    async listConsentCourses(_now: Date): Promise<EctConsentRow[]> {
      const rows = await dbAdmin('ect_courses as ec')
        .leftJoin('patients as p', function () {
          this.on('p.id', '=', 'ec.patient_id')
            .andOn('p.clinic_id', '=', 'ec.clinic_id')
            .andOnNull('p.deleted_at');
        })
        .leftJoin('episodes as ep', function () {
          this.on('ep.id', '=', 'ec.episode_id')
            .andOn('ep.clinic_id', '=', 'ec.clinic_id')
            .andOnNull('ep.deleted_at');
        })
        // Fallback to patient's CURRENT active episode primary clinician
        // when the course's original episode is closed/deleted.
        .joinRaw(`
          LEFT JOIN LATERAL (
            SELECT cur_ep.primary_clinician_id
            FROM episodes AS cur_ep
            WHERE cur_ep.patient_id = ec.patient_id
              AND cur_ep.clinic_id = ec.clinic_id
              AND cur_ep.status = 'open'
              AND cur_ep.deleted_at IS NULL
            ORDER BY cur_ep.start_date DESC
            LIMIT 1
          ) AS cur_ep ON TRUE
        `)
        .whereIn('ec.status', ['planned', 'active'])
        .where('ec.consent_obtained', true)
        .whereNull('ec.deleted_at')
        .whereNotNull('ec.consent_date')
        .whereNotNull('p.id')
        // Bounded scan on source timestamp: long enough to include
        // active older courses without running unbounded historical scans.
        .whereRaw("ec.consent_date::date BETWEEN (CURRENT_DATE - INTERVAL '2 years') AND CURRENT_DATE")
        .select(
          'ec.id as course_id',
          'ec.clinic_id',
          'ec.patient_id',
          'ec.status',
          'ec.consent_date',
          'ec.treating_psychiatrist_id',
          dbAdmin.raw(
            'COALESCE(ep.primary_clinician_id, cur_ep.primary_clinician_id) as primary_clinician_id',
          ),
        );
      return rows as EctConsentRow[];
    },

    async getConsentValidityDays(clinicId) {
      const thresholds = await settingsService.getThresholds(clinicId, dbAdmin);
      return Number(thresholds.ect_consent_validity_days);
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
        signalKey: 'ect_consent_expiry',
      });
    },

    async resolveActiveRecipients(clinicId, treatingPsychiatristId, primaryClinicianId) {
      const candidates = primaryClinicianId
        ? [treatingPsychiatristId, primaryClinicianId]
        : [treatingPsychiatristId];
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

    async writeAuditLogRow({ clinicId, action, courseId, metadata }) {
      await writeAuditLog({
        clinicId,
        actorId: 'system:ect-consent-expiry-scheduler',
        action,
        tableName: 'ect_courses',
        recordId: courseId,
        newData: metadata,
      });
    },

    logger: defaultLogger,
  };
}

const ectConsentExpiryTask = cron.schedule('30 7 * * *', async () => {
  defaultLogger.info('Running ECT consent-expiry scheduler');
  try {
    const ctx = await buildLiveContext();
    const out = await processEctConsentExpiryAlerts(new Date(), ctx);
    defaultLogger.info(out, 'ECT consent-expiry scheduler tick complete');
  } catch (err) {
    defaultLogger.error({ err }, 'ECT consent-expiry scheduler failed');
  }
}, { timezone: 'Australia/Melbourne' });

if (process.env.NODE_ENV !== 'test') {
  registerShutdownHook({
    name: 'scheduler:ect-consent-expiry',
    priority: 84,
    handler: async () => { ectConsentExpiryTask.stop(); },
  });
}

export { ectConsentExpiryTask };
