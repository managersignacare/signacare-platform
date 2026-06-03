// apps/api/src/jobs/schedulers/prescriptionRepeatScheduler.ts
//
// BUG-372c — prescription-repeat alert.
//
// Daily 06:00 AEST cron walks active prescriptions whose `expires_at`
// falls into one of three tier windows:
//   T-7d        warning (or critical for high-risk drug class)
//   T-1d        critical
//   T+overdue   critical
//
// Active prescriptions with `repeats > 0` AND `consumed_count <
// repeats` are eligible — `consumed_count` is derived from
// `erx_tokens.dispensed_at IS NOT NULL` (NOT a column on prescriptions
// per BUG-371 opt-locking guarantee). Skips status='cancelled' /
// 'superseded'.
//
// Drug-class severity promotion: clozapine + lithium + depot
// antipsychotics are bumped to 'critical' even at T-7d because abrupt
// discontinuation is dangerous (clozapine agranulocytosis re-titration
// from scratch; lithium narrow therapeutic window; depot continuity
// gap = relapse risk).
//
// Fan-out: prescribed_by_staff_id (always set) + episodes.primary_clinician_id
// (when episode_id present). Set-collapsed when same staff.
//
// Idempotency: dedupeKey `prescription-repeat:<prescriptionId>:<staffId>:<bucket>`.
// Daily cron + bucket quantisation means the partial unique index on
// `(clinic_id, payload->>'dedupe_key')` rejects duplicates within the
// natural lifetime of each tier (the bucket label changes day-to-day
// as expires_at approaches, so dedupe is per-tier-once).
//
// SCHEDULER ONLY — uses `dbAdmin` per BUG-583. Tenant scoping
// preserved via FK-bound `clinic_id` on every emit.
//
// fix-registry anchors: BUG372C-SCHED-EXISTS, BUG372C-DERIVED-CONSUMED,
// BUG372C-CLOZAPINE-PROMO, BUG372C-BOOTSTRAP, BUG372C-NO-FALSE-COL,
// BUG372C-DBADMIN, BUG372C-ZERO-ROW-WARN.

import cron from 'node-cron';
import { dbAdmin } from '../../db/db';
import { logger as defaultLogger } from '../../utils/logger';
import { registerShutdownHook } from '../../shared/gracefulShutdown';
import { writeAuditLog } from '../../utils/audit';
import { settingsService } from '../../features/settings/settingsService';
import {
  prescriptionRepeatHelpers,
  type PrescriptionRepeatRow,
} from '../../features/prescriptions/prescriptionRepeatHelpers';
import { emitSchedulerSignal } from './schedulerSignalEmitter';

// ── Types ──────────────────────────────────────────────────────────────────

// BUG-591 — added 'T-3d' intermediate tier for HIGH-RISK drugs only.
// Standard drugs keep 3-tier coverage (T-7d / T-1d / T+overdue);
// high-risk drugs (clozapine + lithium + depot-LAIs) get a 4th tier
// at T-3d to close the 6-day gap between T-7d and T-1d. Rationale:
// clozapine gap >2 days = agranulocytosis re-titration from scratch;
// depot-LAI gap = late-stage relapse risk during typical 1-2 week
// dosing intervals.
export type PrescriptionRepeatBucket = 'T-7d' | 'T-3d' | 'T-1d' | 'T+overdue';

export interface PrescriptionRepeatEmitInput {
  clinicId: string;
  userId: string;
  severity: 'warning' | 'critical';
  category: 'prescription-repeat';
  title: string;
  body: string;
  actionUrl: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

export interface PrescriptionRepeatContext {
  listPrescriptionsApproachingRepeatDue(now: Date): Promise<PrescriptionRepeatRow[]>;
  emit(input: PrescriptionRepeatEmitInput): Promise<{ ids: string[]; published: boolean }>;
  /**
   * BUG-589 (sibling of BUG-577 + BUG-584) — filter `staff.is_active =
   * true AND deleted_at IS NULL` over [prescribed_by_staff_id,
   * primary_clinician_id]. When BOTH inactive, fall back to
   * `clinics.nominated_admin_staff_id ?? delegated_admin_staff_id`.
   * Returns `{active, reassignedToAdmin}` with prescriber-first ordering
   * (the registered prescriber per AHPRA discipline barrier
   * §7.3.1 has primary clinical accountability).
   */
  resolveActiveRecipients(
    clinicId: string,
    prescribedByStaffId: string,
    primaryClinicianId: string | null,
  ): Promise<{ active: string[]; reassignedToAdmin: string | null }>;
  /**
   * BUG-589 — AHPRA Standard 1 immutable trail. Writes a metadata-only
   * audit_log row (never-throws via audit-outbox) for routing-fallback
   * events. Sibling of pathologyCriticalScheduler.writeAuditLogRow +
   * mhaReviewScheduler.writeAuditLogRow.
   */
  writeAuditLogRow(input: {
    clinicId: string;
    action: 'PRESCRIPTION_REPEAT_RECIPIENT_REASSIGNED' | 'PRESCRIPTION_REPEAT_NO_RECIPIENT_AVAILABLE';
    prescriptionId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  /**
   * BUG-589-FOLLOWUP-TIER-2-ESCALATION — tier-2 recipients for
   * silent-drop closure. Mirrors pathology/MHA pattern:
   * active team-leads from patient_team_assignments + clinic admin.
   */
  listEscalationRecipients?(
    clinicId: string,
    patientId: string,
  ): Promise<string[]>;
  /**
   * BUG-589-FOLLOWUP-TIER-2-ESCALATION — per-clinic tier-2 threshold
   * (minutes) from settingsService (`prescription_repeat_escalation_minutes`,
   * default 30).
   */
  getEscalationThreshold?(clinicId: string): Promise<number>;
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

export interface PrescriptionRepeatOutcome {
  processed: number;
  emitted: number;
  errors: number;
}

export type { PrescriptionRepeatRow };

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * BUG-372c — bucket quantisation. UTC-day diff between expires_at and
 * `now`. Returns the canonical bucket label or null if outside any
 * tier. Same shape as MHA `bucketForReviewDate` (BUG-372b) — daily
 * cron means the cliff between T-1d and T+overdue is one tick.
 *
 * BUG-591 — `highRisk` parameter enables the T-3d intermediate tier.
 * Standard drugs (highRisk=false) keep 3 buckets; high-risk drugs
 * (clozapine + lithium + depot-LAIs) get T-3d as a 4th tier to close
 * the 6-day continuity gap between T-7d and T-1d. Rationale:
 *   - clozapine: >2-day gap = agranulocytosis re-titration restart
 *   - depot-LAI: 1-2 week dosing intervals; 6-day gap = relapse risk
 */
export function bucketForExpiresAt(
  expiresAt: string,
  now: Date,
  highRisk: boolean = false,
): PrescriptionRepeatBucket | null {
  const exp = new Date(`${expiresAt}T00:00:00.000Z`);
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const diffDays = Math.round((exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 7) return 'T-7d';
  if (diffDays === 3 && highRisk) return 'T-3d'; // BUG-591 — high-risk only
  if (diffDays === 1) return 'T-1d';
  if (diffDays < 0) return 'T+overdue';
  return null;
}

/**
 * BUG-372c — high-risk drug-class detection. Match-list is curated +
 * documented; new entries require a CAB decision (mirrors the
 * prescriber-discipline allow-list in CLAUDE.md §7.3.1).
 *
 * Why these four:
 *   - clozapine: agranulocytosis monitoring + re-titration from scratch
 *     after a gap of >2 days. Continuity break is critical safety.
 *   - lithium: narrow therapeutic window; abrupt stop → rebound mania.
 *   - olanzapine pamoate / risperidone microspheres / paliperidone
 *     palmitate (depot LAIs): continuity gap → relapse risk.
 *
 * BRAND_NAME match-list covers Australian PBS + brand variants
 * (Clopine + Clozaril for clozapine; Zyprexa Relprevv + Consta + Sustenna
 * for the LAIs).
 */
export function isHighRiskDrugClass(meds: {
  generic_name: string | null;
  brand_name: string | null;
}): boolean {
  const probe = `${meds.generic_name ?? ''} ${meds.brand_name ?? ''}`.toLowerCase();
  return (
    probe.includes('clozapine')
    || probe.includes('clopine')
    || probe.includes('clozaril')
    || probe.includes('lithium')
    || probe.includes('olanzapine pamoate')
    || probe.includes('zyprexa relprevv')
    || probe.includes('risperidone microspheres')
    || probe.includes('risperdal consta')
    || probe.includes('paliperidone palmitate')
    || probe.includes('invega sustenna')
    || probe.includes('invega trinza')
  );
}

/**
 * BUG-372c — severity mapping. High-risk drug class promotes EVERY
 * bucket to critical. Standard drugs are warning at T-7d, critical
 * at T-1d / T+overdue.
 *
 * BUG-591 — T-3d intermediate tier is HIGH-RISK ONLY (the bucketing
 * helper only returns T-3d when highRisk=true), so it's always
 * 'critical' here.
 */
export function severityForBucket(
  bucket: PrescriptionRepeatBucket,
  highRisk: boolean,
): 'warning' | 'critical' {
  if (highRisk) return 'critical';
  return bucket === 'T-7d' ? 'warning' : 'critical';
}

/**
 * BUG-372c — dedupe-key shape per partial unique index. Encodes
 * (prescription_id, recipient_staff_id, bucket).
 */
export function dedupeKeyForPrescriptionRepeat(
  prescriptionId: string,
  staffId: string,
  bucket: PrescriptionRepeatBucket,
): string {
  return `prescription-repeat:${prescriptionId}:${staffId}:${bucket}`;
}

/**
 * BUG-589-FOLLOWUP-TIER-2-ESCALATION — tier-2 dedupe namespace, distinct
 * from tier-1 (`prescription-repeat:`) so each tier dedupes independently.
 * Includes UTC day so unresolved high-risk continuity gaps re-alert daily.
 */
export function dedupeKeyForPrescriptionRepeatEscalation(
  prescriptionId: string,
  staffId: string,
  bucket: PrescriptionRepeatBucket,
  now: Date,
): string {
  const day = now.toISOString().slice(0, 10);
  return `prescription-repeat-escalation:${prescriptionId}:${staffId}:${bucket}:fired-day:${day}`;
}

/**
 * BUG-589-FOLLOWUP-TIER-2-ESCALATION — AEST-local threshold gate.
 * Returns true when current Australia/Melbourne local time is at least
 * `thresholdMinutes` past local midnight.
 */
export function isPrescriptionRepeatEscalationDue(
  now: Date,
  thresholdMinutes: number,
): boolean {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Australia/Melbourne',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const minutesIntoDay = hour * 60 + minute;
  return minutesIntoDay >= thresholdMinutes;
}

function titleForBucket(
  drugLabel: string,
  bucket: PrescriptionRepeatBucket,
  highRisk: boolean,
): string {
  const prefix = highRisk ? 'High-risk medication' : 'Prescription';
  if (bucket === 'T+overdue') return `${prefix} OVERDUE — ${drugLabel}`;
  if (bucket === 'T-1d') return `${prefix} expires tomorrow — ${drugLabel}`;
  if (bucket === 'T-3d') return `${prefix} expires in 3 days — ${drugLabel}`;
  return `${prefix} expires in 7 days — ${drugLabel}`;
}

// ── Top-level processor (testable; cron tick wraps this) ───────────────────

export async function processPrescriptionRepeatAlerts(
  now: Date,
  ctx: PrescriptionRepeatContext,
): Promise<PrescriptionRepeatOutcome> {
  const out: PrescriptionRepeatOutcome = { processed: 0, emitted: 0, errors: 0 };
  let rows: PrescriptionRepeatRow[] = [];
  try {
    rows = await ctx.listPrescriptionsApproachingRepeatDue(now);
  } catch (err) {
    ctx.logger.error({ err }, 'prescriptionRepeatScheduler top-level listPrescriptionsApproachingRepeatDue failed');
    return out;
  }

  if (rows.length === 0) {
    ctx.logger.warn(
      { kind: 'PRESCRIPTION_REPEAT_ALERT_ZERO_ROWS', tickAt: now.toISOString() },
      'prescriptionRepeatScheduler returned zero rows (either no prescriptions in window or access-path failure)',
    );
  }

  // BUG-589-FOLLOWUP-TIER-2-ESCALATION — per-clinic escalation threshold
  // cache; resolve once per clinic per tick.
  const escalationThresholdCache = new Map<string, number>();

  for (const row of rows) {
    out.processed++;

    // Skip exhausted prescriptions (consumed >= repeats).
    if (row.consumed_count >= row.repeats) continue;

    // BUG-591 — pass `highRisk` to bucketing helper so high-risk
    // drugs (clozapine + lithium + depot-LAIs) ALSO match T-3d
    // bucket. Standard drugs keep 3-tier coverage.
    const highRisk = isHighRiskDrugClass({
      generic_name: row.generic_name,
      brand_name: row.brand_name,
    });
    const bucket = bucketForExpiresAt(row.expires_at, now, highRisk);
    if (!bucket) continue;

    try {
      // BUG-589 (sibling of BUG-577 + BUG-584) — resolve recipients
      // through the active-staff filter + clinic-admin fallback.
      // Replaces the prior naive Set<prescriber, primary> which
      // silently routed to deactivated users.
      const { active: tier1Recipients, reassignedToAdmin } =
        await ctx.resolveActiveRecipients(
          row.clinic_id,
          row.prescribed_by_staff_id,
          row.primary_clinician_id,
        );
      const severity = severityForBucket(bucket, highRisk);
      const drugLabel = row.generic_name ?? row.brand_name ?? 'medication';
      const title = titleForBucket(drugLabel, bucket, highRisk);
      let tier1SilentDrop = false;

      if (reassignedToAdmin) {
        // BUG-589 reassignment — pino WARN + audit_log row for AHPRA
        // Standard 1 + state Mental Health Act immutable trail.
        ctx.logger.warn(
          {
            kind: 'PRESCRIPTION_REPEAT_RECIPIENT_REASSIGNED_TO_ADMIN',
            prescriptionId: row.prescription_id,
            prescribedByStaffId: row.prescribed_by_staff_id,
            primaryClinicianId: row.primary_clinician_id,
            adminStaffId: reassignedToAdmin,
            bucket,
            genericName: row.generic_name,
            highRiskDrugClass: highRisk,
          },
          'prescriptionRepeatScheduler reassigned to clinic admin (both original recipients inactive)',
        );
        await ctx.writeAuditLogRow({
          clinicId: row.clinic_id,
          action: 'PRESCRIPTION_REPEAT_RECIPIENT_REASSIGNED',
          prescriptionId: row.prescription_id,
          metadata: {
            prescribed_by_staff_id: row.prescribed_by_staff_id,
            primary_clinician_id: row.primary_clinician_id,
            admin_staff_id: reassignedToAdmin,
            bucket,
            generic_name: row.generic_name,
            high_risk_drug_class: highRisk,
            reason: 'both_originals_inactive',
            // BUG-589 cycle-1 — system actor in metadata so AHPRA
            // forensic queries can filter
            // `new_data->>'system_actor'`. Sibling pattern.
            system_actor: 'prescription-repeat-scheduler',
          },
        });
      } else if (tier1Recipients.length === 0) {
        // BUG-589 silent-drop closure: ERROR pino + audit_log row.
        // Worst-case clinical-safety scenario for prescription-
        // repeat continuity (depot-LAI relapse risk; clozapine
        // re-titration restart). Sibling of BUG-577 + BUG-584.
        ctx.logger.error(
          {
            kind: 'PRESCRIPTION_REPEAT_NO_RECIPIENT_AVAILABLE',
            prescriptionId: row.prescription_id,
            prescribedByStaffId: row.prescribed_by_staff_id,
            primaryClinicianId: row.primary_clinician_id,
            bucket,
            genericName: row.generic_name,
            highRiskDrugClass: highRisk,
          },
          'prescriptionRepeatScheduler dropped alert — both recipients inactive AND no clinic admin configured',
        );
        await ctx.writeAuditLogRow({
          clinicId: row.clinic_id,
          action: 'PRESCRIPTION_REPEAT_NO_RECIPIENT_AVAILABLE',
          prescriptionId: row.prescription_id,
          metadata: {
            prescribed_by_staff_id: row.prescribed_by_staff_id,
            primary_clinician_id: row.primary_clinician_id,
            bucket,
            generic_name: row.generic_name,
            high_risk_drug_class: highRisk,
            reason: 'no_admin_configured',
            system_actor: 'prescription-repeat-scheduler',
          },
        });
        // BUG-589-FOLLOWUP-TIER-2-ESCALATION — preserve row fallthrough
        // so tier-2 escalation can attempt fan-out when tier-1 has no
        // reachable recipient.
        tier1SilentDrop = true;
      }

      for (const staffId of tier1Recipients) {
        await ctx.emit({
          clinicId: row.clinic_id,
          userId: staffId,
          severity,
          category: 'prescription-repeat',
          title,
          body: `Prescription has ${row.repeats - row.consumed_count} repeat(s) remaining; expires ${row.expires_at} (${bucket}). Renewal review required.`,
          actionUrl: `/patients/${row.patient_id}/prescriptions/${row.prescription_id}`,
          payload: {
            prescription_id: row.prescription_id,
            patient_id: row.patient_id,
            generic_name: row.generic_name,
            brand_name: row.brand_name,
            repeats: row.repeats,
            consumed_count: row.consumed_count,
            expires_at: row.expires_at,
            bucket,
            high_risk_drug_class: highRisk,
          },
          dedupeKey: dedupeKeyForPrescriptionRepeat(row.prescription_id, staffId, bucket),
        });
        out.emitted++;
      }

      // BUG-589-FOLLOWUP-TIER-2-ESCALATION — when tier-1 silent-drops
      // on a critical bucket, escalate to active team-leads + clinic
      // admin with independent dedupe namespace.
      if (
        tier1SilentDrop
        && severity === 'critical'
        && ctx.getEscalationThreshold
        && ctx.listEscalationRecipients
      ) {
        let escalationThreshold = escalationThresholdCache.get(row.clinic_id);
        if (escalationThreshold === undefined) {
          escalationThreshold = await ctx.getEscalationThreshold(row.clinic_id);
          escalationThresholdCache.set(row.clinic_id, escalationThreshold);
        }
        if (isPrescriptionRepeatEscalationDue(now, escalationThreshold)) {
          const escalationStaff = await ctx.listEscalationRecipients(
            row.clinic_id,
            row.patient_id,
          );
          const escalationLabel =
            escalationThreshold % 60 === 0
              ? `${escalationThreshold / 60}h+`
              : `${escalationThreshold}min+`;
          for (const staffId of escalationStaff) {
            await ctx.emit({
              clinicId: row.clinic_id,
              userId: staffId,
              severity: 'critical',
              category: 'prescription-repeat',
              title: `[ESCALATION] ${title} unacknowledged ${escalationLabel}`,
              body: `Critical prescription-repeat alert has no reachable tier-1 recipient for ${escalationLabel}. Tier-2 escalation — verify renewal action and clinician continuity.`,
              actionUrl: `/patients/${row.patient_id}/prescriptions/${row.prescription_id}`,
              payload: {
                prescription_id: row.prescription_id,
                patient_id: row.patient_id,
                generic_name: row.generic_name,
                brand_name: row.brand_name,
                repeats: row.repeats,
                consumed_count: row.consumed_count,
                expires_at: row.expires_at,
                bucket,
                high_risk_drug_class: highRisk,
                tier: 2,
              },
              dedupeKey: dedupeKeyForPrescriptionRepeatEscalation(
                row.prescription_id,
                staffId,
                bucket,
                now,
              ),
            });
            out.emitted++;
          }
        }
      }
    } catch (err) {
      out.errors++;
      const serialisedErr = err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : err;
      ctx.logger.error(
        { err: serialisedErr, prescriptionId: row.prescription_id },
        'prescriptionRepeatScheduler row failed',
      );
    }
  }

  return out;
}

// ── Live-context construction (used by the cron tick) ──────────────────────

/**
 * Construct the live `PrescriptionRepeatContext` used by the cron tick.
 * Exported so integration tests can invoke `processPrescriptionRepeatAlerts(
 * now, await buildLiveContext())` against a real Postgres + spy on
 * the scheduler signal adapter. Sibling-applicable from BUG-451 batch 1
 * (pathology) + batch 2 (MHA) cycle-2 patterns.
 */
export async function buildLiveContext(): Promise<PrescriptionRepeatContext> {
  return {
    async listPrescriptionsApproachingRepeatDue(_now: Date): Promise<PrescriptionRepeatRow[]> {
      return prescriptionRepeatHelpers.listPrescriptionsApproachingRepeatDue(dbAdmin);
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
        signalKey: 'prescription_repeat_due',
      });
    },

    async resolveActiveRecipients(clinicId, prescribedByStaffId, primaryClinicianId) {
      // BUG-589 (sibling of BUG-577 + BUG-584) — filter inactive
      // staff and fall back to clinic admin if both candidates are
      // inactive. Prescriber-first ordering preserved.
      const candidates = primaryClinicianId
        ? [prescribedByStaffId, primaryClinicianId]
        : [prescribedByStaffId];
      const uniqueCandidates = Array.from(new Set(candidates));
      const staffRows = await dbAdmin('staff')
        .where({ clinic_id: clinicId })
        .whereNull('deleted_at')
        .whereIn('id', uniqueCandidates)
        .select('id', 'is_active', 'deleted_at');
      const active: string[] = [];
      for (const id of uniqueCandidates) {
        const r = staffRows.find((s) => s.id === id);
        if (r && r.is_active && !r.deleted_at) active.push(id);
      }
      if (active.length > 0) {
        return { active, reassignedToAdmin: null };
      }
      const clinic = await dbAdmin('clinics')
        .where({ id: clinicId })
        .whereNull('deleted_at')
        .select('nominated_admin_staff_id', 'delegated_admin_staff_id')
        .first();
      const adminId =
        clinic?.nominated_admin_staff_id ??
        clinic?.delegated_admin_staff_id ??
        null;
      return { active: adminId ? [adminId] : [], reassignedToAdmin: adminId };
    },

    async listEscalationRecipients(clinicId, patientId) {
      // BUG-589-FOLLOWUP-TIER-2-ESCALATION — active team-leads from
      // patient_team_assignments + clinic admin, filtered by
      // staff.is_active + !deleted_at.
      const teamLeads = await dbAdmin('patient_team_assignments as pta')
        .innerJoin('staff as s', 's.id', 'pta.primary_clinician_id')
        .where('pta.patient_id', patientId)
        .where('pta.is_active', true)
        .where('s.clinic_id', clinicId)
        .where('s.is_active', true)
        .whereNull('s.deleted_at')
        .select('pta.primary_clinician_id as staff_id');
      const ids = new Set<string>();
      for (const r of teamLeads) {
        if (r.staff_id) ids.add(String(r.staff_id));
      }
      const clinic = await dbAdmin('clinics')
        .where({ id: clinicId })
        .whereNull('deleted_at')
        .select('nominated_admin_staff_id', 'delegated_admin_staff_id')
        .first();
      if (clinic?.nominated_admin_staff_id) {
        ids.add(String(clinic.nominated_admin_staff_id));
      } else if (clinic?.delegated_admin_staff_id) {
        ids.add(String(clinic.delegated_admin_staff_id));
      }
      return Array.from(ids);
    },

    async getEscalationThreshold(clinicId) {
      // BUG-589-FOLLOWUP-TIER-2-ESCALATION — SSoT default + override
      // in settingsService via clinic_thresholds.
      const t = await settingsService.getThresholds(clinicId, dbAdmin);
      return Number(t['prescription_repeat_escalation_minutes']);
    },

    async writeAuditLogRow({ clinicId, action, prescriptionId, metadata }) {
      // BUG-589 — AHPRA Standard 1 immutable trail. Uses writeAuditLog
      // from utils/audit.ts (never-throws via audit-outbox). The
      // actorId 'system:prescription-repeat-scheduler' is UUID-
      // sanitised to NULL at persistence; the distinguishing forensic
      // axis is `metadata.system_actor` (passed by call site).
      // tableName = 'prescriptions' — forensic queries by table_name +
      // record_id locate the canonical prescription.
      await writeAuditLog({
        clinicId,
        actorId: 'system:prescription-repeat-scheduler',
        action,
        tableName: 'prescriptions',
        recordId: prescriptionId,
        newData: metadata,
      });
    },

    logger: defaultLogger,
  };
}

// ── Cron tick ──────────────────────────────────────────────────────────────

const prescriptionRepeatTask = cron.schedule('0 6 * * *', async () => {
  defaultLogger.info('Running prescription-repeat scheduler');
  try {
    const ctx = await buildLiveContext();
    const out = await processPrescriptionRepeatAlerts(new Date(), ctx);
    defaultLogger.info(out, 'Prescription-repeat scheduler tick complete');
  } catch (err) {
    defaultLogger.error({ err }, 'Prescription-repeat scheduler failed');
  }
}, { timezone: 'Australia/Melbourne' });

if (process.env.NODE_ENV !== 'test') {
  registerShutdownHook({
    name: 'scheduler:prescription-repeat',
    priority: 85,
    handler: async () => { prescriptionRepeatTask.stop(); },
  });
}

export { prescriptionRepeatTask };
