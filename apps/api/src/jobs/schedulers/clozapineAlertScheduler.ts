// apps/api/src/jobs/schedulers/clozapineAlertScheduler.ts
//
// BUG-569 — clozapine FBC overdue alert scheduler.
//
// Every 6 hours (FBC overdue is a 24-72h harm window — daily-class
// urgency, not 15-minute critical-pathology cadence), scan
// `clozapine_registrations` for rows where
//   ceased_date IS NULL                       (active registration)
//   AND deleted_at IS NULL                    (CLAUDE.md §1.4)
//   AND next_blood_due_date < CURRENT_DATE    (overdue)
// AND emit a per-recipient critical notification, deduped by UTC-day so
// the alert fires once per registration per recipient per day (NOT
// every tick).
//
// Why "critical" severity: clozapine-induced agranulocytosis (ANC <
// 0.5×10^9/L) is fatal without monitoring. AHPRA Standard 1 + TGA
// Clozapine Patient Monitoring Service guidance require weekly /
// fortnightly / monthly FBC per `monitoring_frequency`; missing a
// scheduled FBC is the canonical clinical-safety harm class for this
// drug. The alert is the soft-belt to the dispenser's hard-block (the
// pharmacy's CPMS portal refuses to dispense without an in-window FBC).
//
// Recipients (fan-out, both notified when distinct):
//   - clozapine_registrations.prescriber_staff_id   (the registered
//     clozapine prescriber — accountable per AHPRA prescribing
//     discipline barrier; CLAUDE.md §7.3.1)
//   - episodes.primary_clinician_id (when registration.episode_id set
//     and the primary clinician differs from the prescriber — covers
//     handover after the original prescriber rotates off)
//
// SCHEDULER ONLY — uses `dbAdmin` (signacare_owner role) which bypasses
// RLS by virtue of the policy's USING clause not applying to the table
// owner. Bare `db()` (app_user) under no `app.clinic_id` GUC returns
// ZERO rows from RLS-enabled tables. Sibling pattern of BUG-372a
// pathologyCriticalScheduler. Tenant scoping is preserved: every emit
// carries `row.clinic_id` from the row itself (FK-enforced), so
// cross-tenant routing is impossible.
//
// fix-registry anchors: R-FIX-BUG-569-SCHED-EXISTS,
// R-FIX-BUG-569-OVERDUE-CRITERIA, R-FIX-BUG-569-FANOUT,
// R-FIX-BUG-569-DEDUPE-KEY, R-FIX-BUG-569-DBADMIN,
// R-FIX-BUG-569-CRITICAL-SEVERITY, R-FIX-BUG-569-TIMER-SAFETY.

import cron from 'node-cron';
import { dbAdmin } from '../../db/db';
import { logger as defaultLogger } from '../../utils/logger';
import { registerShutdownHook } from '../../shared/gracefulShutdown';
import { emitSchedulerSignal } from './schedulerSignalEmitter';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * @schema-drift-exempt select-aliased
 * BUG-569 — `ClozapineFbcOverdueRow` is a SELECT-aliased shape sourced
 * from a 2-table JOIN (`clozapine_registrations` LEFT JOIN `episodes`),
 * not a 1:1 row from any single table. `registration_id` is
 * `clozapine_registrations.id`; `prescriber_staff_id` and FBC-state
 * fields come from the registrations table; `primary_clinician_id`
 * is sourced from the LEFT JOIN to `episodes`.
 */
export interface ClozapineFbcOverdueRow {
  registration_id: string;
  clinic_id: string;
  patient_id: string;
  prescriber_staff_id: string;
  primary_clinician_id: string | null;
  next_blood_due_date: string;
  last_anc_date: string | null;
  last_anc_value: string | null;
  anc_status: string | null;
  monitoring_frequency: string | null;
  current_dose_mg: string | null;
}

export interface ClozapineOrphanPrescriberRow {
  registration_id: string;
  clinic_id: string;
  patient_id: string;
  primary_clinician_id: string | null;
  nominated_admin_staff_id: string | null;
  delegated_admin_staff_id: string | null;
  next_blood_due_date: string;
  monitoring_frequency: string | null;
  current_dose_mg: string | null;
}

export interface ClozapineFbcOverdueEmitInput {
  clinicId: string;
  userId: string;
  severity: 'critical';
  category: 'clozapine';
  title: string;
  body: string;
  actionUrl: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

export interface ClozapineFbcOverdueContext {
  listOverdue(now: Date): Promise<ClozapineFbcOverdueRow[]>;
  listOrphanedPrescriber(now: Date): Promise<ClozapineOrphanPrescriberRow[]>;
  listActiveStaffIds(clinicId: string, staffIds: string[]): Promise<string[]>;
  emit(input: ClozapineFbcOverdueEmitInput): Promise<{ ids: string[]; published: boolean }>;
  /**
   * Structured logger. Bivariant params keep both `logger.info('msg')`
   * and `logger.error({err, x}, 'msg')` callers happy.
   */
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

export interface ClozapineFbcOverdueOutcome {
  processed: number;
  emitted: number;
  errors: number;
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * BUG-569 — overdue criteria. A registration is overdue when
 * `next_blood_due_date < today` AND it is still active (ceased_date
 * is enforced upstream in the SELECT WHERE so this helper just
 * verifies the date axis). Helper is pure / testable; the full SELECT
 * predicate lives in `buildLiveContext.listOverdue`.
 */
export function isOverdueRegistration(
  row: { next_blood_due_date: string },
  now: Date,
): boolean {
  // Compare in UTC-day granularity. `next_blood_due_date` is a Postgres
  // `date` (no time component); next-due "2026-04-25" is overdue at
  // any point on 2026-04-26 onwards.
  const dueIso = String(row.next_blood_due_date).slice(0, 10);
  const todayIso = now.toISOString().slice(0, 10);
  return dueIso < todayIso;
}

/**
 * BUG-569 — dedupe-key shape for the partial unique index on
 * `(clinic_id, payload->>'dedupe_key')`. UTC-day bucket so an
 * unacknowledged overdue FBC fires once per day per recipient (NOT
 * every 6-hour tick).
 *
 * Same UTC-day boundary semantics as BUG-372a: bucket flips at 10:00
 * AEST (11:00 AEDT during summer time). Acceptable because the
 * partial unique index dedupes at INSERT — two distinct legitimate
 * emits across the day boundary, not a double-fire.
 */
export function dedupeKeyForClozapineFbcOverdue(
  registrationId: string,
  staffId: string,
  now: Date,
): string {
  const day = now.toISOString().slice(0, 10);
  return `clozapine-fbc-overdue:${registrationId}:${staffId}:fired-day:${day}`;
}

export function dedupeKeyForClozapineOrphanPrescriber(
  registrationId: string,
  staffId: string,
  now: Date,
): string {
  const day = now.toISOString().slice(0, 10);
  return `clozapine-orphan-prescriber:${registrationId}:${staffId}:fired-day:${day}`;
}

/**
 * BUG-569 — daysOverdue helper (pure, for body string). Negative values
 * impossible because the upstream WHERE filters `next_blood_due_date <
 * CURRENT_DATE`; this helper preserves test-ability of edge cases
 * (boundary day, large overdue counts).
 */
export function daysOverdue(nextDue: string, now: Date): number {
  const d = new Date(`${String(nextDue).slice(0, 10)}T00:00:00.000Z`);
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return Math.max(0, Math.round((today.getTime() - d.getTime()) / 86_400_000));
}

// ── Top-level processor (testable; cron tick wraps this) ───────────────────

/**
 * Process clozapine registrations with overdue FBC monitoring.
 *
 * Failure isolation per CLAUDE.md §3.2 / §9.6:
 *   - Top-level try/catch — top-level failure logged, processor returns
 *     zeroed counts (cron itself never dies).
 *   - Per-row try/catch — single row failure logged with
 *     `{err, registrationId}`, subsequent rows continue.
 */
export async function processClozapineFbcOverdueAlerts(
  now: Date,
  ctx: ClozapineFbcOverdueContext,
): Promise<ClozapineFbcOverdueOutcome> {
  const out: ClozapineFbcOverdueOutcome = { processed: 0, emitted: 0, errors: 0 };
  let rows: ClozapineFbcOverdueRow[] = [];
  try {
    rows = await ctx.listOverdue(now);
  } catch (err) {
    ctx.logger.error({ err }, 'clozapineAlertScheduler top-level listOverdue failed');
    return out;
  }

  // Distinguish "no overdue registrations" from "RLS or other access
  // path returned zero rows" — sibling observability signal to BUG-372a.
  if (rows.length === 0) {
    ctx.logger.warn(
      { kind: 'CLOZAPINE_FBC_OVERDUE_ZERO_ROWS', tickAt: now.toISOString() },
      'clozapineAlertScheduler returned zero rows (either no overdue FBCs or access-path failure)',
    );
  }

  for (const row of rows) {
    out.processed++;
    if (!isOverdueRegistration(row, now)) continue;

    try {
      const recipients = new Set<string>();
      recipients.add(row.prescriber_staff_id);
      if (row.primary_clinician_id) recipients.add(row.primary_clinician_id);

      const overdueDays = daysOverdue(row.next_blood_due_date, now);
      const ancContext = row.last_anc_value
        ? `last ANC ${row.last_anc_value}${row.anc_status ? ` (${row.anc_status})` : ''} on ${row.last_anc_date ?? 'unknown date'}`
        : 'no prior ANC on record';

      for (const staffId of recipients) {
        await ctx.emit({
          clinicId: row.clinic_id,
          userId: staffId,
          severity: 'critical',
          category: 'clozapine',
          title: `Clozapine FBC overdue (${overdueDays}d)`,
          body: `FBC monitoring overdue ${overdueDays} day(s); ${ancContext}; due ${String(row.next_blood_due_date).slice(0, 10)}. Order FBC + EUC before next dose.`,
          actionUrl: `/patients/${row.patient_id}/clozapine`,
          payload: {
            registration_id: row.registration_id,
            patient_id: row.patient_id,
            next_blood_due_date: row.next_blood_due_date,
            last_anc_date: row.last_anc_date,
            last_anc_value: row.last_anc_value,
            anc_status: row.anc_status,
            monitoring_frequency: row.monitoring_frequency,
            current_dose_mg: row.current_dose_mg,
            days_overdue: overdueDays,
          },
          dedupeKey: dedupeKeyForClozapineFbcOverdue(row.registration_id, staffId, now),
        });
        out.emitted++;
      }
    } catch (err) {
      out.errors++;
      ctx.logger.error(
        { err, registrationId: row.registration_id },
        'clozapineAlertScheduler row failed',
      );
    }
  }

  // BUG-569-FOLLOWUP-ORPHAN-PRESCRIBER-FALLBACK — separate alert class
  // for active registrations that lost `prescriber_staff_id` (NULL after
  // staff separation / transfer). These are intentionally excluded from
  // the overdue-prescriber path above to prevent clinic-wide broadcast,
  // but must not remain silent.
  let orphanRows: ClozapineOrphanPrescriberRow[] = [];
  try {
    orphanRows = await ctx.listOrphanedPrescriber(now);
  } catch (err) {
    out.errors++;
    ctx.logger.error({ err }, 'clozapineAlertScheduler orphan-prescriber query failed');
    return out;
  }

  for (const row of orphanRows) {
    out.processed++;
    try {
      const candidateRecipients = Array.from(
        new Set(
          [
            row.primary_clinician_id,
            row.nominated_admin_staff_id,
            row.delegated_admin_staff_id,
          ].filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      );

      if (candidateRecipients.length === 0) {
        out.errors++;
        ctx.logger.error(
          {
            kind: 'CLOZAPINE_ORPHAN_PRESCRIBER_NO_RECIPIENT_CONFIGURED',
            registrationId: row.registration_id,
            clinicId: row.clinic_id,
          },
          'clozapineAlertScheduler orphan registration has no primary/admin recipient configured',
        );
        continue;
      }

      const activeIds = await ctx.listActiveStaffIds(row.clinic_id, candidateRecipients);
      const activeSet = new Set(activeIds);
      const recipients = candidateRecipients.filter((id) => activeSet.has(id));

      if (recipients.length === 0) {
        out.errors++;
        ctx.logger.error(
          {
            kind: 'CLOZAPINE_ORPHAN_PRESCRIBER_NO_ACTIVE_RECIPIENT',
            registrationId: row.registration_id,
            clinicId: row.clinic_id,
            candidateRecipients,
          },
          'clozapineAlertScheduler orphan registration has no active recipient',
        );
        continue;
      }

      for (const staffId of recipients) {
        await ctx.emit({
          clinicId: row.clinic_id,
          userId: staffId,
          severity: 'critical',
          category: 'clozapine',
          title: 'Clozapine registration missing prescriber',
          body: `Active clozapine registration has no assigned prescriber. Reassign prescriber before next dispense window (next blood due ${String(row.next_blood_due_date).slice(0, 10)}).`,
          actionUrl: `/patients/${row.patient_id}/clozapine`,
          payload: {
            registration_id: row.registration_id,
            patient_id: row.patient_id,
            next_blood_due_date: row.next_blood_due_date,
            monitoring_frequency: row.monitoring_frequency,
            current_dose_mg: row.current_dose_mg,
            alert_kind: 'orphan_prescriber_registration',
          },
          dedupeKey: dedupeKeyForClozapineOrphanPrescriber(row.registration_id, staffId, now),
        });
        out.emitted++;
      }
    } catch (err) {
      out.errors++;
      ctx.logger.error(
        { err, registrationId: row.registration_id },
        'clozapineAlertScheduler orphan-prescriber row failed',
      );
    }
  }

  return out;
}

// ── Live-context construction (used by the cron tick) ──────────────────────

/**
 * Construct the live `ClozapineFbcOverdueContext` used by the cron tick.
 * Exported so integration tests can invoke
 * `processClozapineFbcOverdueAlerts(now, await buildLiveContext())`
 * against a real Postgres + spy on the scheduler signal adapter.
 * Sibling-applicable from BUG-451 batches 1-4 cycle-2 patterns.
 */
export async function buildLiveContext(): Promise<ClozapineFbcOverdueContext> {
  return {
    async listOverdue(_now: Date): Promise<ClozapineFbcOverdueRow[]> {
      // SCHEDULER ONLY — uses `dbAdmin` so RLS does not silent-zero
      // the result. Per-row `clinic_id` is FK-bound and propagated on
      // every emit, preserving tenant isolation at the notification
      // boundary. Sibling pattern of BUG-372a pathologyCriticalScheduler.
      // BUG-569 L4+L5 absorb-1 (advisory absorbed inline 2026-05-01):
      // `clozapine_registrations.prescriber_staff_id` is nullable in
      // the migration (FK SET NULL on staff delete). Without this
      // `.whereNotNull` filter, a NULL prescriber_staff_id would flow
      // into `recipients.add(null)` + scheduler signal emit({
      // userId: null })` which per notificationService.ts becomes a
      // CLINIC-WIDE BROADCAST — a CRITICAL clozapine alert fanning
      // to every staff member in the clinic (alert fatigue + PHI
      // egress beyond the care team). Filtering here drops orphaned
      // registrations from this alert path entirely; the orphan case
      // (active clozapine registration without a registered
      // prescriber) is handled by the dedicated orphan-prescriber
      // alert class below (`listOrphanedPrescriber` path).
      const rows = await dbAdmin('clozapine_registrations as cr')
        .leftJoin('episodes as ep', 'ep.id', 'cr.episode_id')
        .whereNull('cr.ceased_date')
        .whereNull('cr.deleted_at')
        .whereNull('ep.deleted_at')
        .whereNotNull('cr.prescriber_staff_id')
        .whereRaw("cr.next_blood_due_date < CURRENT_DATE")
        .select(
          'cr.id as registration_id',
          'cr.clinic_id',
          'cr.patient_id',
          'cr.prescriber_staff_id',
          'ep.primary_clinician_id',
          'cr.next_blood_due_date',
          'cr.last_anc_date',
          'cr.last_anc_value',
          'cr.anc_status',
          'cr.monitoring_frequency',
          'cr.current_dose_mg',
        );
      return rows as ClozapineFbcOverdueRow[];
    },

    async listOrphanedPrescriber(_now: Date): Promise<ClozapineOrphanPrescriberRow[]> {
      const rows = await dbAdmin('clozapine_registrations as cr')
        .leftJoin('episodes as ep', 'ep.id', 'cr.episode_id')
        .leftJoin('clinics as c', 'c.id', 'cr.clinic_id')
        .whereNull('cr.ceased_date')
        .whereNull('cr.deleted_at')
        .whereNull('ep.deleted_at')
        .whereNull('cr.prescriber_staff_id')
        .select(
          'cr.id as registration_id',
          'cr.clinic_id',
          'cr.patient_id',
          'ep.primary_clinician_id',
          'c.nominated_admin_staff_id',
          'c.delegated_admin_staff_id',
          'cr.next_blood_due_date',
          'cr.monitoring_frequency',
          'cr.current_dose_mg',
        );
      return rows as ClozapineOrphanPrescriberRow[];
    },

    async listActiveStaffIds(clinicId: string, staffIds: string[]): Promise<string[]> {
      if (staffIds.length === 0) return [];
      const rows = await dbAdmin('staff')
        .where({ clinic_id: clinicId, is_active: true })
        .whereNull('deleted_at')
        .whereIn('id', staffIds)
        .select('id');
      return rows.map((r) => String(r.id));
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
        signalKey: 'clozapine_fbc_overdue',
      });
    },

    logger: defaultLogger,
  };
}

// ── Cron tick ──────────────────────────────────────────────────────────────

// Every 6 hours at minute 0 — 00:00, 06:00, 12:00, 18:00 AEST. Daily-class
// urgency (FBC overdue is a 24-72h harm window) — more frequent ticks
// would just spam the WARN-zero-rows log on quiet days.
const clozapineAlertTask = cron.schedule('0 */6 * * *', async () => {
  defaultLogger.info('Running clozapine FBC overdue alert scheduler');
  try {
    const ctx = await buildLiveContext();
    const out = await processClozapineFbcOverdueAlerts(new Date(), ctx);
    defaultLogger.info(out, 'Clozapine FBC overdue alert scheduler tick complete');
  } catch (err) {
    defaultLogger.error({ err }, 'Clozapine FBC overdue alert scheduler failed');
  }
}, { timezone: 'Australia/Melbourne' });

if (process.env.NODE_ENV !== 'test') {
  registerShutdownHook({
    name: 'scheduler:clozapine-fbc-overdue',
    priority: 85,
    handler: async () => { clozapineAlertTask.stop(); },
  });
}

export { clozapineAlertTask };
