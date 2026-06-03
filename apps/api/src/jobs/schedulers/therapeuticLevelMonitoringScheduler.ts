// apps/api/src/jobs/schedulers/therapeuticLevelMonitoringScheduler.ts
//
// BUG-592 — therapeutic-level monitoring overdue alert. Consolidates
// the per-drug schedulers BUG-571 (lithium) + BUG-580 (warfarin/INR)
// into a single drug-class-driven scheduler covering lithium,
// valproate, carbamazepine, warfarin, and phenytoin.
//
// Daily 06:30 AEST cron walks active prescriptions of these drugs and
// joins each patient's most-recent matching pathology_results to
// determine if surveillance is overdue. NEVER-drawn cases (no prior
// result) AND threshold-exceeded cases both fire.
//
// Why these five drugs:
//   - lithium: narrow therapeutic window (0.4-1.0 mEq/L); toxicity
//     above 1.5 → renal / cardiac / cognitive harm. Default 90 days.
//   - valproate: hepatotoxicity + aplastic anaemia surveillance;
//     level 50-100 mcg/mL. Default 90 days.
//   - carbamazepine: aplastic anaemia + auto-induction; level
//     4-12 mcg/mL. Default 90 days.
//   - warfarin: INR drift outside therapeutic range = bleed/thrombosis
//     risk in atrial-fibrillation co-prescription. Default 14 days.
//   - phenytoin: narrow therapeutic window + non-linear kinetics;
//     toxicity and seizure-risk harm when levels are not monitored.
//     Default 90 days.
//
// Recipient fan-out: prescribed_by_staff_id (always set) +
// episodes.primary_clinician_id (with current-team fallback per
// BUG-590 — sibling-perfect with prescriptionRepeatHelpers).
//
// BUG-589-sibling routing: active-staff filter (`is_active = true AND
// deleted_at IS NULL`) + clinic-admin fallback when both inactive +
// audit_log + ERROR-on-silent-drop.
//
// Severity: 'critical' for all bucket cases (level surveillance gap is
// always critical — no warning tier; missing surveillance is a
// patient-harm class regardless of which drug).
//
// SCHEDULER ONLY — uses `dbAdmin` per BUG-583. Tenant scoping
// preserved via FK-bound `clinic_id` on every emit.
//
// fix-registry anchors: R-FIX-BUG-592-SCHED-EXISTS,
// R-FIX-BUG-592-DRUG-CLASS-LOOP, R-FIX-BUG-592-NEVER-DRAWN-DETECTION,
// R-FIX-BUG-592-CRITICAL-SEVERITY, R-FIX-BUG-592-DBADMIN,
// R-FIX-BUG-592-AUDIT-LOG-REASSIGN,
// R-FIX-BUG-592-AUDIT-LOG-NO-RECIPIENT.

import cron from 'node-cron';
import { dbAdmin } from '../../db/db';
import { logger as defaultLogger } from '../../utils/logger';
import { registerShutdownHook } from '../../shared/gracefulShutdown';
import { writeAuditLog } from '../../utils/audit';
import { settingsService } from '../../features/settings/settingsService';
import {
  applyDrugTokenFilter,
  therapeuticLevelHelpers,
  THERAPEUTIC_LEVEL_DRUG_CONFIG,
  type TherapeuticLevelOverdueRow,
} from '../../features/prescriptions/therapeuticLevelHelpers';
import { emitSchedulerSignal } from './schedulerSignalEmitter';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TherapeuticLevelEmitInput {
  clinicId: string;
  userId: string;
  severity: 'critical';
  category: 'therapeutic-level';
  title: string;
  body: string;
  actionUrl: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

interface DistinctClinicIdRow {
  clinic_id: string;
}

export interface TherapeuticLevelContext {
  /**
   * Returns drug-config + threshold pairs to walk this tick. Per-clinic
   * thresholds are fetched here so the per-drug-class loop in the
   * processor doesn't N+1 on settings lookups.
   */
  resolveDrugConfigs(clinicIds: string[]): Promise<
    Array<{
      clinicId: string;
      drugConfig: typeof THERAPEUTIC_LEVEL_DRUG_CONFIG[number];
      thresholdDays: number;
    }>
  >;
  listOverdueTherapeuticLevels(
    drugConfig: typeof THERAPEUTIC_LEVEL_DRUG_CONFIG[number],
    thresholdDays: number,
    // BUG-592 cycle-2 absorb (L3 #1) — REQUIRED per-clinic scoping.
    clinicId: string,
  ): Promise<TherapeuticLevelOverdueRow[]>;
  emit(input: TherapeuticLevelEmitInput): Promise<{ ids: string[]; published: boolean }>;
  resolveActiveRecipients(
    clinicId: string,
    prescribedByStaffId: string,
    primaryClinicianId: string | null,
  ): Promise<{ active: string[]; reassignedToAdmin: string | null }>;
  writeAuditLogRow(input: {
    clinicId: string;
    action:
      | 'THERAPEUTIC_LEVEL_RECIPIENT_REASSIGNED'
      | 'THERAPEUTIC_LEVEL_NO_RECIPIENT_AVAILABLE';
    prescriptionId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  /**
   * BUG-592-FOLLOWUP-TIER-2-ESCALATION — tier-2 recipients for
   * silent-drop closure: active team-leads + clinic admin.
   */
  listEscalationRecipients?(
    clinicId: string,
    patientId: string,
  ): Promise<string[]>;
  /**
   * BUG-592-FOLLOWUP-TIER-2-ESCALATION — per-clinic tier-2 threshold
   * in minutes (`therapeutic_level_escalation_minutes`, default 30).
   */
  getEscalationThreshold?(clinicId: string): Promise<number>;
  /** Returns clinics that have at least one active prescription of any monitored drug class. */
  listClinicsToWalk(): Promise<string[]>;
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

export interface TherapeuticLevelOutcome {
  processed: number;
  emitted: number;
  errors: number;
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * BUG-592 — dedupe-key shape per partial unique index. Encodes
 * (drug_label, prescription_id, recipient_staff_id, fired-day) so
 * tier-1 fires once per recipient per UTC day.
 *
 * UTC-day bucket means re-firing daily for perpetually-overdue
 * surveillance — sibling-perfect with pathology + MHA daily-bump
 * pattern (R-FIX-BUG-585-ESCALATION-DEDUPE-DAILY-BUMP).
 */
export function dedupeKeyForTherapeuticLevel(
  drugLabel: string,
  prescriptionId: string,
  staffId: string,
  now: Date,
): string {
  const day = now.toISOString().slice(0, 10);
  return `therapeutic-level:${drugLabel}:${prescriptionId}:${staffId}:fired-day:${day}`;
}

/**
 * BUG-592-FOLLOWUP-TIER-2-ESCALATION — distinct tier-2 dedupe namespace.
 */
export function dedupeKeyForTherapeuticLevelEscalation(
  drugLabel: string,
  prescriptionId: string,
  staffId: string,
  now: Date,
): string {
  const day = now.toISOString().slice(0, 10);
  return `therapeutic-level-escalation:${drugLabel}:${prescriptionId}:${staffId}:fired-day:${day}`;
}

/**
 * BUG-592-FOLLOWUP-TIER-2-ESCALATION — AEST-local threshold gate.
 */
export function isTherapeuticLevelEscalationDue(
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

/**
 * BUG-592 — title formatter. NEVER-drawn case (no prior result)
 * surfaces explicitly so a clinician knows it's not just "overdue"
 * but "NEVER ordered" — different clinical action (initial baseline
 * vs follow-up).
 */
export function titleForTherapeuticLevel(
  drugLabel: string,
  testCode: string,
  daysSinceLastResult: number | null,
): string {
  if (daysSinceLastResult === null) {
    return `${drugLabel} ${testCode} level NEVER drawn — baseline required`;
  }
  return `${drugLabel} ${testCode} level overdue (${daysSinceLastResult} days)`;
}

// ── Top-level processor (testable; cron tick wraps this) ───────────────────

export async function processTherapeuticLevelAlerts(
  now: Date,
  ctx: TherapeuticLevelContext,
): Promise<TherapeuticLevelOutcome> {
  const out: TherapeuticLevelOutcome = { processed: 0, emitted: 0, errors: 0 };

  let clinicIds: string[] = [];
  try {
    clinicIds = await ctx.listClinicsToWalk();
  } catch (err) {
    ctx.logger.error({ err }, 'therapeuticLevelMonitoringScheduler top-level listClinicsToWalk failed');
    return out;
  }

  if (clinicIds.length === 0) {
    ctx.logger.warn(
      { kind: 'THERAPEUTIC_LEVEL_ALERT_ZERO_CLINICS', tickAt: now.toISOString() },
      'therapeuticLevelMonitoringScheduler returned zero clinics (either no clinics with monitored prescriptions or access-path failure)',
    );
    return out;
  }

  let drugConfigs: Awaited<ReturnType<TherapeuticLevelContext['resolveDrugConfigs']>> = [];
  try {
    drugConfigs = await ctx.resolveDrugConfigs(clinicIds);
  } catch (err) {
    ctx.logger.error({ err }, 'therapeuticLevelMonitoringScheduler resolveDrugConfigs failed');
    return out;
  }

  // BUG-592-FOLLOWUP-TIER-2-ESCALATION — per-clinic tier-2 threshold
  // cache; resolve once per clinic per tick.
  const escalationThresholdCache = new Map<string, number>();

  for (const { clinicId, drugConfig, thresholdDays } of drugConfigs) {
    let rows: TherapeuticLevelOverdueRow[] = [];
    try {
      // BUG-592 cycle-2 absorb (L3 #1) — pass clinicId so the helper
      // SQL filters by clinic. Pre-cycle-2 the helper was global,
      // causing N×M duplicate processing + cross-clinic threshold
      // drift + duplicate audit_log rows.
      rows = await ctx.listOverdueTherapeuticLevels(drugConfig, thresholdDays, clinicId);
    } catch (err) {
      ctx.logger.error(
        { err, drugLabel: drugConfig.drugLabel, thresholdDays, clinicId },
        'therapeuticLevelMonitoringScheduler listOverdueTherapeuticLevels failed',
      );
      continue; // try next drug class
    }

    for (const row of rows) {
      out.processed++;

      try {
        const { active: tier1Recipients, reassignedToAdmin } =
          await ctx.resolveActiveRecipients(
            row.clinic_id,
            row.prescribed_by_staff_id,
            row.primary_clinician_id,
          );
        let tier1SilentDrop = false;

        if (reassignedToAdmin) {
          ctx.logger.warn(
            {
              kind: 'THERAPEUTIC_LEVEL_RECIPIENT_REASSIGNED_TO_ADMIN',
              prescriptionId: row.prescription_id,
              prescribedByStaffId: row.prescribed_by_staff_id,
              primaryClinicianId: row.primary_clinician_id,
              adminStaffId: reassignedToAdmin,
              drugLabel: row.drug_label,
              testCode: row.test_code,
              daysSinceLastResult: row.days_since_last_result,
            },
            'therapeuticLevelMonitoringScheduler reassigned to clinic admin (both original recipients inactive)',
          );
          await ctx.writeAuditLogRow({
            clinicId: row.clinic_id,
            action: 'THERAPEUTIC_LEVEL_RECIPIENT_REASSIGNED',
            prescriptionId: row.prescription_id,
            metadata: {
              prescribed_by_staff_id: row.prescribed_by_staff_id,
              primary_clinician_id: row.primary_clinician_id,
              admin_staff_id: reassignedToAdmin,
              drug_label: row.drug_label,
              test_code: row.test_code,
              days_since_last_result: row.days_since_last_result,
              reason: 'both_originals_inactive',
              system_actor: 'therapeutic-level-monitoring-scheduler',
            },
          });
        } else if (tier1Recipients.length === 0) {
          ctx.logger.error(
            {
              kind: 'THERAPEUTIC_LEVEL_NO_RECIPIENT_AVAILABLE',
              prescriptionId: row.prescription_id,
              prescribedByStaffId: row.prescribed_by_staff_id,
              primaryClinicianId: row.primary_clinician_id,
              drugLabel: row.drug_label,
              testCode: row.test_code,
              daysSinceLastResult: row.days_since_last_result,
            },
            'therapeuticLevelMonitoringScheduler dropped alert — both recipients inactive AND no clinic admin configured',
          );
          await ctx.writeAuditLogRow({
            clinicId: row.clinic_id,
            action: 'THERAPEUTIC_LEVEL_NO_RECIPIENT_AVAILABLE',
            prescriptionId: row.prescription_id,
            metadata: {
              prescribed_by_staff_id: row.prescribed_by_staff_id,
              primary_clinician_id: row.primary_clinician_id,
              drug_label: row.drug_label,
              test_code: row.test_code,
              days_since_last_result: row.days_since_last_result,
              reason: 'no_admin_configured',
              system_actor: 'therapeutic-level-monitoring-scheduler',
            },
          });
          // BUG-592-FOLLOWUP-TIER-2-ESCALATION — preserve fallthrough
          // to tier-2 fan-out.
          tier1SilentDrop = true;
        }

        const title = titleForTherapeuticLevel(
          row.drug_label,
          row.test_code,
          row.days_since_last_result,
        );
        const body =
          row.last_result_date === null
            ? `Patient prescribed ${row.drug_label} has NEVER had a ${row.test_code} level drawn. Initial baseline required for therapeutic-level surveillance.`
            : `Patient prescribed ${row.drug_label} last had a ${row.test_code} level on ${row.last_result_date} (${row.days_since_last_result} days ago). Surveillance overdue per per-clinic threshold.`;

        for (const staffId of tier1Recipients) {
          await ctx.emit({
            clinicId: row.clinic_id,
            userId: staffId,
            severity: 'critical',
            category: 'therapeutic-level',
            title,
            body,
            actionUrl: `/patients/${row.patient_id}/pathology`,
            payload: {
              prescription_id: row.prescription_id,
              patient_id: row.patient_id,
              generic_name: row.generic_name,
              brand_name: row.brand_name,
              drug_label: row.drug_label,
              test_code: row.test_code,
              last_result_date: row.last_result_date,
              days_since_last_result: row.days_since_last_result,
              never_drawn: row.last_result_date === null,
            },
            dedupeKey: dedupeKeyForTherapeuticLevel(
              row.drug_label,
              row.prescription_id,
              staffId,
              now,
            ),
          });
          out.emitted++;
        }

        // BUG-592-FOLLOWUP-TIER-2-ESCALATION — when tier-1 has no
        // reachable recipient, escalate to active team-leads + clinic
        // admin with independent dedupe namespace.
        if (
          tier1SilentDrop
          && ctx.getEscalationThreshold
          && ctx.listEscalationRecipients
        ) {
          let escalationThreshold = escalationThresholdCache.get(row.clinic_id);
          if (escalationThreshold === undefined) {
            escalationThreshold = await ctx.getEscalationThreshold(row.clinic_id);
            escalationThresholdCache.set(row.clinic_id, escalationThreshold);
          }
          if (isTherapeuticLevelEscalationDue(now, escalationThreshold)) {
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
                category: 'therapeutic-level',
                title: `[ESCALATION] ${title} unacknowledged ${escalationLabel}`,
                body: `Critical therapeutic-level alert has no reachable tier-1 recipient for ${escalationLabel}. Tier-2 escalation — verify urgent clinician follow-through.`,
                actionUrl: `/patients/${row.patient_id}/pathology`,
                payload: {
                  prescription_id: row.prescription_id,
                  patient_id: row.patient_id,
                  generic_name: row.generic_name,
                  brand_name: row.brand_name,
                  drug_label: row.drug_label,
                  test_code: row.test_code,
                  last_result_date: row.last_result_date,
                  days_since_last_result: row.days_since_last_result,
                  never_drawn: row.last_result_date === null,
                  tier: 2,
                },
                dedupeKey: dedupeKeyForTherapeuticLevelEscalation(
                  row.drug_label,
                  row.prescription_id,
                  staffId,
                  now,
                ),
              });
              out.emitted++;
            }
          }
        }
      } catch (err) {
        out.errors++;
        ctx.logger.error(
          { err, prescriptionId: row.prescription_id, drugLabel: row.drug_label },
          'therapeuticLevelMonitoringScheduler row failed',
        );
      }
    }
  }

  return out;
}

// ── Live-context construction (used by the cron tick) ──────────────────────

/**
 * Construct the live `TherapeuticLevelContext` used by the cron tick.
 * Exported so integration tests can invoke `processTherapeuticLevelAlerts(
 * now, await buildLiveContext())` against a real Postgres + spy on
 * the scheduler signal adapter. Sibling-applicable from BUG-451 batch 1
 * (pathology) + batch 2 (MHA) + batch 3 (prescription-repeat) cycle-2
 * patterns.
 */
export async function buildLiveContext(): Promise<TherapeuticLevelContext> {
  return {
    async listClinicsToWalk(): Promise<string[]> {
      // Find clinics that have at least one active prescription of any
      // monitored drug class. Avoids walking every drug for clinics
      // with no exposure.
      // BUG-592 cycle-2 absorb — strip word-boundary regex anchors
      // before SQL ILIKE token use (regex engine vs SQL ILIKE differ).
      const tokens = THERAPEUTIC_LEVEL_DRUG_CONFIG.flatMap((c) =>
        c.pattern.source
          .replace(/^\\b\(/, '')
          .replace(/\)\\b$/, '')
          .split('|'),
      );
      const query = dbAdmin('prescriptions')
        .whereIn('status', ['active', 'dispensed'])
        .whereNull('deleted_at')
        .distinct('clinic_id');
      applyDrugTokenFilter(
        query,
        'generic_name',
        'brand_name',
        tokens.map((token) => token.trim()).filter(Boolean),
      );
      const rows: DistinctClinicIdRow[] = await query;
      return rows.map((r) => String(r.clinic_id));
    },

    async resolveDrugConfigs(clinicIds: string[]) {
      const out: Array<{
        clinicId: string;
        drugConfig: typeof THERAPEUTIC_LEVEL_DRUG_CONFIG[number];
        thresholdDays: number;
      }> = [];
      for (const clinicId of clinicIds) {
        // BUG-592-FOLLOWUP-DBADMIN-THRESHOLDS — pass `dbAdmin` so the
        // RLS-bound `clinic_thresholds` lookup does not silent-zero
        // in cron context (no `app.clinic_id` GUC outside Express).
        // Pre-fix, per-clinic threshold customisation in Power Settings
        // was INERT for all therapeutic-level drug classes — operator
        // could set `therapeutic_level_lithium_days = 60` and the
        // scheduler would still use the 90-day default. Sibling pattern
        // of BUG-583 RLS-zero closure.
        const thresholds = await settingsService.getThresholds(clinicId, dbAdmin);
        for (const drugConfig of THERAPEUTIC_LEVEL_DRUG_CONFIG) {
          const thresholdDays = Number(
            thresholds[drugConfig.thresholdKey] ?? drugConfig.defaultThresholdDays,
          );
          out.push({ clinicId, drugConfig, thresholdDays });
        }
      }
      return out;
    },

    async listOverdueTherapeuticLevels(drugConfig, thresholdDays, clinicId) {
      return therapeuticLevelHelpers.listOverdueTherapeuticLevels(
        dbAdmin,
        drugConfig,
        thresholdDays,
        clinicId,
      );
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
        signalKey: 'therapeutic_level_overdue',
      });
    },

    async resolveActiveRecipients(clinicId, prescribedByStaffId, primaryClinicianId) {
      // Sibling pattern of BUG-577 / BUG-584 / BUG-589.
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
      // BUG-592-FOLLOWUP-TIER-2-ESCALATION — active team-leads from
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
      const t = await settingsService.getThresholds(clinicId, dbAdmin);
      return Number(t['therapeutic_level_escalation_minutes']);
    },

    async writeAuditLogRow({ clinicId, action, prescriptionId, metadata }) {
      await writeAuditLog({
        clinicId,
        actorId: 'system:therapeutic-level-monitoring-scheduler',
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

// Daily 06:30 AEST — after pathology critical (15-min cron) and
// prescription-repeat (06:00 AEST). Therapeutic-level monitoring is
// daily-class urgency (level surveillance windows are days/weeks; not
// minute-critical).
const therapeuticLevelTask = cron.schedule('30 6 * * *', async () => {
  defaultLogger.info('Running therapeutic-level monitoring scheduler');
  try {
    const ctx = await buildLiveContext();
    const out = await processTherapeuticLevelAlerts(new Date(), ctx);
    defaultLogger.info(out, 'Therapeutic-level monitoring scheduler tick complete');
  } catch (err) {
    defaultLogger.error({ err }, 'Therapeutic-level monitoring scheduler failed');
  }
}, { timezone: 'Australia/Melbourne' });

if (process.env.NODE_ENV !== 'test') {
  registerShutdownHook({
    name: 'scheduler:therapeutic-level-monitoring',
    priority: 85,
    handler: async () => { therapeuticLevelTask.stop(); },
  });
}

export { therapeuticLevelTask };
